import { register } from 'node:module';

register(new URL('./ts-resolve-hook.mjs', import.meta.url));

const {
	listItems,
	listEdges,
	listDecisions,
	listConcepts,
	listThreads,
	createItem,
	createEdge,
	createDecision,
	createConcept,
	createThread,
	createMessage
} = await import('../src/lib/store.js');

async function main() {
	if (listItems().length > 0) {
		console.log('board already populated — skipping');
		return;
	}

	const plan = createItem({
		kind: 'plan',
		title: 'v0.1 storage layer',
		body_md:
			'Ship a durable storage layer for the board.\n\n- SQLite persistence behind the store\n- Seed a demo board (`npm run seed`)\n- Recovery ops: `npm run db:reset` / `db:backup`',
		x: 40,
		y: 60,
		w: 240,
		h: 140,
		status: 'in_progress',
		tags: ['roadmap']
	});

	const persistTask = createItem({
		kind: 'task',
		title: 'Implement SQLite persistence',
		body_md: 'WAL mode, auto-migrations, FTS5 indexes. Done in M0.',
		x: 360,
		y: 40,
		w: 240,
		h: 140,
		status: 'done',
		tags: ['storage']
	});

	const apiTask = createItem({
		kind: 'task',
		title: 'Build REST API endpoints',
		body_md: 'Items, edges, threads, decisions, concepts, brief, agent tasks.',
		x: 360,
		y: 240,
		w: 240,
		h: 140,
		status: 'in_progress',
		tags: ['api']
	});

	const opsTask = createItem({
		kind: 'task',
		title: 'Add seed + db ops scripts',
		body_md: 'npm run seed, seed:reset, db:reset, db:backup — issue 37.',
		x: 680,
		y: 240,
		w: 240,
		h: 140,
		status: 'open',
		tags: ['tooling']
	});

	const conceptNode = createItem({
		kind: 'concept',
		title: 'Decision database',
		body_md:
			'Compact, structured context for agents: decisions, concepts, threads — never a context-window flood.',
		x: 680,
		y: 40,
		w: 240,
		h: 140,
		status: 'open',
		tags: ['design']
	});

	createItem({
		kind: 'note',
		title: 'Risk: WAL growth under load',
		body_md:
			'Long-running writers can grow data/buildboard.db-wal. Run `npm run db:backup` before risky changes; db:reset is the recovery path.',
		x: 1000,
		y: 120,
		w: 240,
		h: 140,
		status: 'open',
		tags: ['risk']
	});

	createEdge({ from_id: plan.id, to_id: persistTask.id, kind: 'depends_on' });
	createEdge({ from_id: plan.id, to_id: apiTask.id, kind: 'depends_on' });
	createEdge({ from_id: apiTask.id, to_id: opsTask.id, kind: 'depends_on' });
	createEdge({ from_id: conceptNode.id, to_id: plan.id, kind: 'relates_to', label: 'informs' });

	createDecision({
		item_id: plan.id,
		question: 'Which storage backend?',
		options: ['SQLite', 'Postgres'],
		rationale: ''
	});

	createConcept({
		name: 'WAL journaling',
		definition:
			"SQLite's write-ahead log: writes go to a -wal file first, then checkpoint into the main database file.",
		details_md: 'Safe for a single writer; a plain file copy is only safe when no writer is active.',
		item_id: plan.id
	});

	const thread = createThread('Storage backend discussion', plan.id);
	createMessage({
		thread_id: thread.id,
		role: 'user',
		content: 'SQLite or Postgres for the board storage layer?'
	});
	createMessage({
		thread_id: thread.id,
		role: 'agent',
		content:
			'SQLite: zero-ops, single file, trivial to back up. Postgres only if we later need concurrent multi-process writers. The seed script exercises the SQLite path end-to-end.'
	});

	console.log(
		`seeded demo board: ${listItems().length} items, ${listEdges().length} edges, ${listDecisions().length} decision, ${listConcepts().length} concept, ${listThreads().length} thread`
	);
}

main();
