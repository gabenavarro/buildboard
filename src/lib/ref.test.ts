import { DatabaseSync } from 'node:sqlite';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupDb, cleanupTempDirs, freshDb } from '../test/testdb.js';

beforeEach(() => {
	freshDb();
});

afterEach(() => {
	cleanupDb();
});

afterAll(() => {
	cleanupTempDirs();
});

function jsonBody(body: unknown): Request {
	return new Request('http://localhost/api', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
}

function apiEvent(params: Record<string, string>, url: string, request?: Request) {
	return {
		request: request ?? new Request(url),
		params,
		url: new URL(url)
	} as never;
}

describe('newRef', () => {
	it('produces 4 lowercase hex characters', async () => {
		const { newRef } = await import('./db.js');
		for (let i = 0; i < 20; i++) {
			expect(newRef()).toMatch(/^[0-9a-f]{4}$/);
		}
	});
});

describe('ref uniqueness', () => {
	it('assigns unique 4-hex refs across items, decisions, and concepts', async () => {
		const { getDb } = await import('./db.js');
		const { createItem, createDecision, createConcept } = await import('./store.js');
		for (let i = 0; i < 30; i++) createItem({ title: `item ${i}` });
		for (let i = 0; i < 20; i++) createDecision({ question: `question ${i}` });
		for (let i = 0; i < 20; i++) createConcept({ name: `concept ${i}` });
		const db = getDb();
		const refs = [
			...(db.prepare('SELECT ref FROM items').all() as { ref: string | null }[]),
			...(db.prepare('SELECT ref FROM decisions').all() as { ref: string | null }[]),
			...(db.prepare('SELECT ref FROM concepts').all() as { ref: string | null }[])
		].map((r) => r.ref);
		expect(refs).toHaveLength(70);
		for (const ref of refs) expect(ref).toMatch(/^[0-9a-f]{4}$/);
		expect(new Set(refs).size).toBe(refs.length);
	});
});

describe('migration backfill', () => {
	it('backfills unique refs on a pre-ref schema and keeps new rows working', async () => {
		const dbFile = freshDb();
		const { MIGRATIONS } = await import('./db.js');
		const seed = new DatabaseSync(dbFile);
		seed.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
		)`);
		const refIdx = MIGRATIONS.findIndex((sql) => sql.includes('ADD COLUMN ref'));
		for (let i = 0; i < refIdx; i++) {
			seed.exec(MIGRATIONS[i]);
			seed.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(`m${String(i).padStart(3, '0')}`);
		}
		seed.prepare("INSERT INTO items (id, kind, title, board_id) VALUES ('i1', 'task', 'old task', 'default')").run();
		seed.prepare("INSERT INTO items (id, kind, title, board_id) VALUES ('i2', 'note', 'old note', 'default')").run();
		seed.prepare("INSERT INTO decisions (id, item_id, question) VALUES ('d1', 'i1', 'old question')").run();
		seed.prepare("INSERT INTO concepts (id, name) VALUES ('c1', 'old concept')").run();
		seed.close();

		const { getDb } = await import('./db.js');
		const db = getDb();
		const all = [
			...db.prepare('SELECT ref FROM items').all(),
			...db.prepare('SELECT ref FROM decisions').all(),
			...db.prepare('SELECT ref FROM concepts').all()
		] as { ref: string | null }[];
		expect(all).toHaveLength(4);
		for (const row of all) expect(row.ref).toMatch(/^[0-9a-f]{4}$/);
		expect(new Set(all.map((r) => r.ref)).size).toBe(all.length);

		const { createItem, resolveRef } = await import('./store.js');
		const created = createItem({ title: 'new after upgrade' });
		expect(created.ref).toMatch(/^[0-9a-f]{4}$/);
		const oldRef = (db.prepare('SELECT ref FROM items WHERE id = ?').get('i1') as { ref: string }).ref;
		expect(resolveRef(oldRef)?.source).toBe('item');
		expect(resolveRef(oldRef)?.id).toBe('i1');
	});
});

describe('resolveRef', () => {
	it('finds items, decisions, and concepts by ref with the right source', async () => {
		const { createItem, createDecision, createConcept, resolveRef } = await import('./store.js');
		const item = createItem({ title: 'findable item' });
		const decision = createDecision({ question: 'findable question', item_id: item.id });
		const concept = createConcept({ name: 'findable concept', item_id: item.id });

		const byItem = resolveRef(item.ref!);
		expect(byItem?.source).toBe('item');
		expect(byItem?.id).toBe(item.id);
		expect(byItem?.title).toBe('findable item');
		expect(byItem?.status).toBe('open');
		expect(byItem?.board_id).toBe('default');

		const byDecision = resolveRef(decision.ref!);
		expect(byDecision?.source).toBe('decision');
		expect(byDecision?.id).toBe(decision.id);
		expect(byDecision?.title).toBe('findable question');
		expect(byDecision?.board_id).toBe('default');

		const byConcept = resolveRef(concept.ref!);
		expect(byConcept?.source).toBe('concept');
		expect(byConcept?.id).toBe(concept.id);
		expect(byConcept?.title).toBe('findable concept');
		expect(byConcept?.board_id).toBe('default');
	});

	it('returns null for an unknown ref', async () => {
		const { resolveRef } = await import('./store.js');
		expect(resolveRef('dead')).toBeNull();
	});
});

describe('recordDecision', () => {
	it('creates a decision item, decision row, and seeded thread sharing one ref', async () => {
		const { recordDecision, getThreadForItem, listMessages, getItem, getDecision } =
			await import('./store.js');
		const result = recordDecision({
			question: 'Which storage engine?',
			options: ['sqlite', 'postgres'],
			why: 'simplicity',
			rec: 'sqlite'
		});
		expect(result.ref).toMatch(/^[0-9a-f]{4}$/);
		expect(result.item.kind).toBe('decision');
		expect(result.item.title).toBe('Which storage engine?');
		expect(result.item.status).toBe('open');
		expect(result.item.board_id).toBe('default');
		expect(result.item.body_md).toContain('Why: simplicity');
		expect(result.item.body_md).toContain('Rec: sqlite');
		expect(result.item.ref).toBe(result.ref);
		expect(result.decision.item_id).toBe(result.item.id);
		expect(result.decision.question).toBe('Which storage engine?');
		expect(result.decision.options).toEqual(['sqlite', 'postgres']);
		expect(result.decision.choice).toBeNull();
		expect(result.decision.rationale).toBe('simplicity');
		expect(result.decision.ref).toBe(result.ref);

		const thread = getThreadForItem(result.item.id);
		expect(thread).not.toBeNull();
		const messages = listMessages(thread!.id);
		expect(messages).toHaveLength(1);
		expect(messages[0].role).toBe('system');
		expect(messages[0].content).toBe('Which storage engine?');

		expect(getItem(result.ref)?.id).toBe(result.item.id);
		expect(getDecision(result.ref)?.id).toBe(result.decision.id);
	});

	it('honors an explicit ref and board, and 404s on an unknown board', async () => {
		const { recordDecision, createBoard, StoreError } = await import('./store.js');
		const board = createBoard('Decision board');
		const result = recordDecision({ question: 'Custom ref?', ref: 'beef', board_id: board.id });
		expect(result.ref).toBe('beef');
		expect(result.item.board_id).toBe(board.id);

		expect(() => recordDecision({ question: 'x', board_id: 'nope' })).toThrow(StoreError);
	});
});

describe('resolveDecision', () => {
	it('sets the choice, posts a thread message with meta, marks the item done, and unblocks blocked items', async () => {
		const {
			recordDecision,
			resolveDecision,
			createItem,
			createEdge,
			getItem,
			getThreadForItem,
			listMessages
		} = await import('./store.js');
		const rec = recordDecision({ question: 'Pick a path', options: ['A', 'B'] });
		const blocked = createItem({ title: 'waiting task', kind: 'task', status: 'blocked' });
		createEdge({ from_id: blocked.id, to_id: rec.item.id, kind: 'blocks' });
		const busy = createItem({ title: 'busy task', kind: 'task', status: 'in_progress' });
		createEdge({ from_id: busy.id, to_id: rec.item.id, kind: 'blocks' });

		const result = resolveDecision(rec.ref, 'a');
		expect(result.decision.choice).toBe('A');
		expect(result.item.status).toBe('done');
		expect(result.unblocked.map((u) => u.id)).toEqual([blocked.id]);
		expect(getItem(blocked.id)?.status).toBe('open');
		expect(getItem(busy.id)?.status).toBe('in_progress');

		const thread = getThreadForItem(rec.item.id);
		const messages = listMessages(thread!.id);
		expect(messages).toHaveLength(2);
		const answer = messages[1];
		expect(answer.role).toBe('system');
		expect(answer.content).toContain('A');
		expect(JSON.parse(answer.meta!)).toEqual({ ref: rec.ref, decision_id: rec.decision.id });
	});

	it('is idempotent for the same choice', async () => {
		const { recordDecision, resolveDecision, getThreadForItem, listMessages } = await import('./store.js');
		const rec = recordDecision({ question: 'Repeat?', options: ['yes', 'no'] });
		resolveDecision(rec.ref, 'yes');
		const again = resolveDecision(rec.ref, 'yes');
		expect(again.decision.choice).toBe('yes');
		expect(again.unblocked).toEqual([]);
		const thread = getThreadForItem(rec.item.id);
		expect(listMessages(thread!.id)).toHaveLength(2);
	});

	it('normalizes answers: exact match, option index, free text without options', async () => {
		const { recordDecision, resolveDecision, StoreError } = await import('./store.js');
		const exact = recordDecision({ question: 'Exact?', options: ['alpha', 'beta'] });
		expect(resolveDecision(exact.ref, 'BETA').decision.choice).toBe('beta');

		const indexed = recordDecision({ question: 'Indexed?', options: ['alpha', 'beta', 'gamma'] });
		expect(resolveDecision(indexed.ref, '2').decision.choice).toBe('beta');
		expect(resolveDecision(indexed.ref, 'option 3').decision.choice).toBe('gamma');

		const free = recordDecision({ question: 'Open ended?' });
		expect(resolveDecision(free.ref, '  because reasons  ').decision.choice).toBe('because reasons');

		expect(() => resolveDecision(exact.ref, 'nope')).toThrow(StoreError);
		expect(() => resolveDecision(exact.ref, '99')).toThrow(StoreError);
	});

	it('resolves the attached decision when given the decision item ref', async () => {
		const { createItem, createDecision, resolveDecision } = await import('./store.js');
		const item = createItem({ title: 'anchor', kind: 'decision' });
		const decision = createDecision({ item_id: item.id, question: 'Anchor question', options: ['x'], ref: 'cafe' });
		expect(decision.ref).toBe('cafe');
		const result = resolveDecision(item.ref!, 'x');
		expect(result.decision.id).toBe(decision.id);
		expect(result.decision.choice).toBe('x');
		expect(result.item.id).toBe(item.id);
	});

	it('throws 404 StoreError for an unknown ref', async () => {
		const { resolveDecision, StoreError } = await import('./store.js');
		try {
			resolveDecision('beef', 'x');
			throw new Error('expected throw');
		} catch (e) {
			expect(e).toBeInstanceOf(StoreError);
			expect((e as { status: number }).status).toBe(404);
		}
	});
});

describe('brief', () => {
	it('lists active decisions with ref, options, and block count', async () => {
		const { recordDecision, createItem, createEdge } = await import('./store.js');
		const { buildBrief } = await import('./digest.js');
		const rec = recordDecision({ question: 'Brief decision', options: ['left', 'right'] });
		const blocked = createItem({ title: 'brief blocker', kind: 'task', status: 'blocked' });
		createEdge({ from_id: blocked.id, to_id: rec.item.id, kind: 'blocks' });
		const brief = buildBrief({});
		expect(brief).toContain(`[${rec.ref}] Brief decision`);
		expect(brief).toContain('options: left, right');
		expect(brief).toContain('(blocks: 1)');
		expect(brief).toContain('bb_decision_resolve');
	});
});

describe('REST ref endpoints', () => {
	it('GET /api/ref/:ref resolves by source and 404s on unknown', async () => {
		const { createItem, createDecision, createConcept } = await import('./store.js');
		const { GET } = await import('../routes/api/ref/[ref]/+server.js');
		const item = createItem({ title: 'rest item' });
		const decision = createDecision({ question: 'rest question', item_id: item.id });
		const concept = createConcept({ name: 'rest concept', item_id: item.id });

		const byItem = await GET(apiEvent({ ref: item.ref! }, `http://localhost/api/ref/${item.ref}`));
		expect(byItem.status).toBe(200);
		expect(((await byItem.json()) as { source: string }).source).toBe('item');

		const byDecision = await GET(apiEvent({ ref: decision.ref! }, `http://localhost/api/ref/${decision.ref}`));
		expect(((await byDecision.json()) as { source: string }).source).toBe('decision');

		const byConcept = await GET(apiEvent({ ref: concept.ref! }, `http://localhost/api/ref/${concept.ref}`));
		expect(((await byConcept.json()) as { source: string }).source).toBe('concept');

		const missing = await GET(apiEvent({ ref: 'beef' }, 'http://localhost/api/ref/beef'));
		expect(missing.status).toBe(404);
	});

	it('create endpoints accept and return ref; decisions list filters by ?ref=', async () => {
		const { POST: postItem } = await import('../routes/api/items/+server.js');
		const { POST: postDecision, GET: listDecisions } = await import('../routes/api/decisions/+server.js');
		const { POST: postConcept } = await import('../routes/api/concepts/+server.js');

		const itemRes = await postItem(apiEvent({}, 'http://localhost/api/items', jsonBody({ title: 'with ref', ref: 'dead' })));
		expect(itemRes.status).toBe(201);
		expect(((await itemRes.json()) as { ref: string }).ref).toBe('dead');

		const decisionRes = await postDecision(
			apiEvent({}, 'http://localhost/api/decisions', jsonBody({ question: 'rest question 2', ref: 'cafe' }))
		);
		expect(decisionRes.status).toBe(201);
		expect(((await decisionRes.json()) as { ref: string }).ref).toBe('cafe');

		const conceptRes = await postConcept(
			apiEvent({}, 'http://localhost/api/concepts', jsonBody({ name: 'rest concept 2', ref: 'face' }))
		);
		expect(conceptRes.status).toBe(201);
		expect(((await conceptRes.json()) as { ref: string }).ref).toBe('face');

		const filtered = await listDecisions(
			apiEvent({}, 'http://localhost/api/decisions?ref=cafe')
		);
		const filteredBody = (await filtered.json()) as { id: string; ref: string }[];
		expect(filteredBody).toHaveLength(1);
		expect(filteredBody[0].ref).toBe('cafe');

		const otherRef = await listDecisions(apiEvent({}, 'http://localhost/api/decisions?ref=dead'));
		expect((await otherRef.json()) as unknown[]).toEqual([]);
	});
});

describe('glossary upsert', () => {
	it('creates a concept with a ref, then upserts by normalized name without duplicating', async () => {
		const { upsertConceptByName, getConceptByName, listConcepts } = await import('./store.js');
		const first = upsertConceptByName('Cache', { definition: 'memoized store' });
		expect(first.ref).toBeTruthy();
		expect(first.name).toBe('Cache');

		// casefold + trim dedup: same normalized name updates, does not duplicate
		const again = upsertConceptByName('  cache ', { definition: 'a fast lookup table' });
		expect(again.id).toBe(first.id);
		expect(again.definition).toBe('a fast lookup table');
		expect(listConcepts()).toHaveLength(1);

		expect(getConceptByName('CACHE')?.id).toBe(first.id);
	});

	it('keeps distinct names separate and defaults definition to empty', async () => {
		const { upsertConceptByName, listConcepts } = await import('./store.js');
		const a = upsertConceptByName('alpha', { definition: 'first' });
		const b = upsertConceptByName('beta');
		expect(a.id).not.toBe(b.id);
		expect(b.definition).toBe('');
		expect(listConcepts()).toHaveLength(2);
	});
});

describe('task bridge', () => {
	it('recordTask creates a task item with a [tt] title, ref, and seeded thread', async () => {
		const { recordTask, getItem, getThreadForItem, listMessages } = await import('./store.js');
		const { ref, item } = recordTask({ what: 'write the docs' });
		expect(item.kind).toBe('task');
		expect(item.title).toBe('[tt] write the docs');
		expect(ref).toBeTruthy();
		expect(getItem(item.id)?.ref).toBe(ref);
		const thread = getThreadForItem(item.id);
		expect(thread).toBeTruthy();
		expect(listMessages(thread!.id)).toHaveLength(1);
	});

	it('updateItem sets pct and marks the item done at pct=100', async () => {
		const { createItem, updateItem } = await import('./store.js');
		const item = createItem({ title: 'progress', kind: 'task' });
		const mid = updateItem(item.id, { pct: 50 });
		expect(mid?.pct).toBe(50);
		expect(mid?.status).toBe('open');
		const done = updateItem(item.id, { pct: 100 });
		expect(done?.pct).toBe(100);
		expect(done?.status).toBe('done');
	});

	it('clamps pct into 0-100', async () => {
		const { createItem, updateItem } = await import('./store.js');
		const item = createItem({ title: 'clamp', kind: 'task' });
		expect(updateItem(item.id, { pct: 150 })?.pct).toBe(100);
		const it2 = createItem({ title: 'clamp2', kind: 'task' });
		expect(updateItem(it2.id, { pct: -20 })?.pct).toBe(0);
	});
});

describe('POST /api/tasks', () => {
	it('records a task and returns ref + item', async () => {
		const { POST: postTask } = await import('../routes/api/tasks/+server.js');
		const res = await postTask(apiEvent({}, 'http://localhost/api/tasks', jsonBody({ what: 'ship it', board_id: 'default' })));
		expect(res.status).toBe(201);
		/** @type {{ ref?: string; item?: { kind: string; title: string } }} */
		const body = await res.json();
		expect(body.ref).toBeTruthy();
		expect(body.item?.kind).toBe('task');
		expect(body.item?.title).toBe('[tt] ship it');
	});
});

describe('POST /api/concepts/upsert', () => {
	it('upserts by name (case-insensitive) and returns the concept', async () => {
		const { POST: postUpsert } = await import('../routes/api/concepts/upsert/+server.js');
		const c1 = (await (
			await postUpsert(apiEvent({}, 'http://localhost/api/concepts/upsert', jsonBody({ name: 'Glossary Term', definition: 'one' })))
		).json()) as { id: string; definition: string };
		const c2 = (await (
			await postUpsert(apiEvent({}, 'http://localhost/api/concepts/upsert', jsonBody({ name: 'glossary term', definition: 'two' })))
		).json()) as { id: string; definition: string };
		expect(c2.id).toBe(c1.id);
		expect(c2.definition).toBe('two');
	});
});
