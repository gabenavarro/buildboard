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

describe('threads & messages', () => {
	it('creates a thread for an item and posts messages', async () => {
		const { createItem, createThread, getThreadForItem, createMessage, listMessages } = await import('../lib/store.js');
		const item = createItem({ title: 'plan A' });
		const thread = createThread('Discussion', item.id);
		expect(getThreadForItem(item.id)?.id).toBe(thread.id);

		createMessage({ thread_id: thread.id, content: 'hello', role: 'user' });
		createMessage({ thread_id: thread.id, content: 'world', role: 'subagent' });
		const msgs = listMessages(thread.id);
		expect(msgs).toHaveLength(2);
		expect(msgs[0].content).toBe('hello');
		expect(msgs[1].role).toBe('subagent');
	});
});

describe('decisions', () => {
	it('records, supersedes, and lists decisions', async () => {
		const { createItem, createDecision, updateDecision, listDecisions } = await import('../lib/store.js');
		const item = createItem({ title: 'choice' });
		const d = createDecision({
			item_id: item.id,
			question: 'Which adapter?',
			options: ['node', 'static'],
			choice: 'node',
			rationale: 'we run a server'
		});
		expect(listDecisions({ item_id: item.id })).toHaveLength(1);
		const updated = updateDecision(d.id, { status: 'superseded' });
		expect(updated?.status).toBe('superseded');
		expect(listDecisions({ item_id: item.id, status: 'active' })).toHaveLength(0);
	});
});

describe('concepts', () => {
	it('creates and looks up concepts by item', async () => {
		const { createItem, createConcept, getConceptForItem, listConcepts } = await import('../lib/store.js');
		const item = createItem({ title: 'WAL' });
		const c = createConcept({ name: 'WAL', definition: 'Write-Ahead Logging', item_id: item.id });
		expect(getConceptForItem(item.id)?.id).toBe(c.id);
		expect(listConcepts()).toHaveLength(1);
	});
});

describe('search (FTS5)', () => {
	it('finds items, decisions, concepts, and messages by text', async () => {
		const {
			createItem,
			createDecision,
			createConcept,
			createThread,
			createMessage
		} = await import('../lib/store.js');
		const { search } = await import('../lib/search.js');

		createItem({ title: 'quantum entanglement protocol', body_md: 'pairs of qubits' });
		createDecision({ question: 'should we use quantum entanglement?', rationale: 'risky' });
		createConcept({ name: 'entanglement', definition: 'correlated qubits' });
		const thread = createThread('t');
		createMessage({ thread_id: thread.id, content: 'entanglement is spooky' });

		const hits = search('entanglement');
		expect(hits.length).toBeGreaterThanOrEqual(3);
		const sources = new Set(hits.map((h) => h.source));
		expect(sources.has('item')).toBe(true);
		expect(sources.has('decision')).toBe(true);
		expect(sources.has('concept')).toBe(true);
		expect(sources.has('message')).toBe(true);

		// update triggers keep the index in sync
		const { updateItem } = await import('../lib/store.js');
		const item = (await import('../lib/store.js')).listItems().find((i) => i.title.startsWith('quantum'))!;
		updateItem(item.id, { title: 'renamed thing' });
		expect(search('quantum').some((h) => h.source === 'item')).toBe(false);
	});

	it('scopes hits to a single board via board_id', async () => {
		const { createItem, createBoard, createDecision, createConcept, createThread, createMessage } =
			await import('../lib/store.js');
		const { search } = await import('../lib/search.js');

		const side = createBoard('Side');
		const defaultItem = createItem({ title: 'quantum default note', body_md: 'quantum on the main board' });
		const sideItem = createItem({ title: 'quantum side note', board_id: side.id });
		createDecision({ item_id: defaultItem.id, question: 'quantum default question' });
		createDecision({ item_id: sideItem.id, question: 'quantum side question' });
		createConcept({ name: 'quantum default concept', item_id: defaultItem.id });
		createConcept({ name: 'quantum side concept', item_id: sideItem.id });
		const defaultThread = createThread('default thread', defaultItem.id);
		const sideThread = createThread('side thread', sideItem.id);
		createMessage({ thread_id: defaultThread.id, content: 'quantum default message' });
		createMessage({ thread_id: sideThread.id, content: 'quantum side message' });

		const all = new Set(search('quantum').map((h) => h.id));
		expect(all.has(defaultItem.id)).toBe(true);
		expect(all.has(sideItem.id)).toBe(true);

		const sideHits = search('quantum', { board_id: side.id });
		const sideIds = new Set(sideHits.map((h) => h.id));
		expect(sideIds.has(sideItem.id)).toBe(true);
		expect(sideIds.has(defaultItem.id)).toBe(false);

		// every source type is scoped through its item/board context
		const sideSources = new Set(sideHits.map((h) => h.source));
		expect(sideSources.has('item')).toBe(true);
		expect(sideSources.has('decision')).toBe(true);
		expect(sideSources.has('concept')).toBe(true);
		expect(sideSources.has('message')).toBe(true);

		const defaultHits = search('quantum', { board_id: 'default' });
		expect(defaultHits.map((h) => h.id)).toContain(defaultItem.id);
		expect(defaultHits.map((h) => h.id)).not.toContain(sideItem.id);
	});
});

	describe('brief (digest)', () => {
		it('produces a compact digest reflecting board state', async () => {
			const { createItem, createDecision, createConcept } = await import('../lib/store.js');
			const { buildBrief } = await import('../lib/digest.js');

			expect(buildBrief()).toContain('Board brief (0 items)');

			const item = createItem({ title: 'ship it', kind: 'task', status: 'open' });
			createDecision({ item_id: item.id, question: 'Q?', choice: 'A' });
			createConcept({ name: 'C', definition: 'a definition', item_id: item.id });

			const brief = buildBrief();
			expect(brief).toContain('ship it');
			expect(brief).toContain('Q? → A');
			expect(brief).toContain('C: a definition');
			expect(brief.length).toBeLessThan(2000);
		});

		it('scopes to a single board: each board brief contains only its own items, decisions, and concepts', async () => {
			const { createItem, createBoard, createDecision, createConcept, createThread, createMessage } =
				await import('../lib/store.js');
			const { buildBrief } = await import('../lib/digest.js');

			const b = createBoard('Side');
			const a = createItem({ title: 'alpha task', kind: 'task' });
			const beta = createItem({ title: 'beta task', kind: 'task', board_id: b.id });
			createDecision({ item_id: a.id, question: 'Alpha question' });
			createDecision({ item_id: beta.id, question: 'Beta question' });
			createConcept({ name: 'alpha-concept', definition: 'only on default', item_id: a.id });
			createConcept({ name: 'beta-concept', definition: 'only on side', item_id: beta.id });
			const ta = createThread('Alpha thread', a.id);
			const tb = createThread('Beta thread', beta.id);
			createMessage({ thread_id: ta.id, content: 'alpha message' });
			createMessage({ thread_id: tb.id, content: 'beta message' });

			const defaultBrief = buildBrief();
			expect(defaultBrief).toContain('Board brief (1 items)');
			expect(defaultBrief).toContain('alpha task');
			expect(defaultBrief).not.toContain('beta task');
			expect(defaultBrief).toContain('Alpha question');
			expect(defaultBrief).not.toContain('Beta question');
			expect(defaultBrief).toContain('alpha-concept');
			expect(defaultBrief).not.toContain('beta-concept');
			expect(defaultBrief).toContain('alpha message');
			expect(defaultBrief).not.toContain('beta message');

			const sideBrief = buildBrief({ board_id: b.id });
			expect(sideBrief).toContain('Board brief (1 items)');
			expect(sideBrief).toContain('beta task');
			expect(sideBrief).not.toContain('alpha task');
			expect(sideBrief).toContain('Beta question');
			expect(sideBrief).not.toContain('Alpha question');
			expect(sideBrief).toContain('beta-concept');
			expect(sideBrief).not.toContain('alpha-concept');
			expect(sideBrief).toContain('beta message');
			expect(sideBrief).not.toContain('alpha message');
		});

		it('emits a Counts section with per-kind/per-status tallies and unresolved_decisions', async () => {
			const { createItem, createDecision, createThread, createMessage } = await import('../lib/store.js');
			const { buildBrief } = await import('../lib/digest.js');

			createItem({ title: 't1', kind: 'task', status: 'open' });
			const t2 = createItem({ title: 't2', kind: 'task', status: 'done' });
			createItem({ title: 'n1', kind: 'note', status: 'open' });
			createDecision({ item_id: t2.id, question: 'unresolved Q' });
			createDecision({ item_id: t2.id, question: 'resolved Q', choice: 'A' });
			// orphan decision (no item) must not count
			createDecision({ question: 'orphan Q' });
			const thread = createThread('t');
			createMessage({ thread_id: thread.id, content: 'hi' });

			const brief = buildBrief();
			expect(brief).toContain('## Counts');
			expect(brief).toContain('task 2');
			expect(brief).toContain('note 1');
			expect(brief).toContain('open 2');
			expect(brief).toContain('done 1');
			expect(brief).toContain('unresolved_decisions: 1');
		});

		it('scales section sizes with token_budget', async () => {
			const { getDb } = await import('../lib/db.js');
			const { createItem } = await import('../lib/store.js');
			const { buildBrief } = await import('../lib/digest.js');

			const ids: string[] = [];
			for (let i = 0; i < 30; i++) {
				ids.push(createItem({ title: `task ${String(i).padStart(2, '0')}`, kind: 'task' }).id);
			}
			// distinct created_at per item so the newest-N ordering is deterministic
			const db = getDb();
			const base = Date.parse('2026-01-01T00:00:00.000Z');
			ids.forEach((id, i) => {
				db.prepare('UPDATE items SET created_at = ? WHERE id = ?').run(
					new Date(base + i * 1000).toISOString(),
					id
				);
			});

			const defaultBrief = buildBrief();
			const big = buildBrief({ token_budget: 400 });
			const small = buildBrief({ token_budget: 50 });

			// default keeps the historical LIMIT (newest 12 open tasks)
			expect(defaultBrief).toContain('task 18 (open)');
			expect(defaultBrief).not.toContain('task 17 (open)');
			// 400 tokens doubles the limit (24): reaches task 06, not task 05
			expect(big).toContain('task 06 (open)');
			expect(big).not.toContain('task 05 (open)');
			// 50 tokens quarters the limit (3)
			expect(small.length).toBeLessThan(big.length);
			expect(small).toContain('task 27 (open)');
			expect(small).not.toContain('task 26 (open)');
		});
	});
