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

describe('items store', () => {
	it('creates and lists items', async () => {
		const { createItem, listItems, getItem } = await import('../lib/store.js');
		const item = createItem({ title: 'First task', kind: 'task', x: 10, y: 20, tags: ['a', 'b'] });
		expect(item.id).toBeTruthy();
		expect(item.kind).toBe('task');
		expect(item.tags).toEqual(['a', 'b']);

		expect(listItems()).toHaveLength(1);
		expect(getItem(item.id)?.title).toBe('First task');
	});

	it('filters by kind and tag', async () => {
		const { createItem, listItems } = await import('../lib/store.js');
		createItem({ title: 'note1', kind: 'note', tags: ['x'] });
		createItem({ title: 'task1', kind: 'task', tags: ['y'] });
		expect(listItems({ kind: 'task' })).toHaveLength(1);
		expect(listItems({ tag: 'x' })).toHaveLength(1);
	});

	it('updates and deletes items', async () => {
		const { createItem, updateItem, deleteItem, getItem } = await import('../lib/store.js');
		const item = createItem({ title: 'to update' });
		const updated = updateItem(item.id, { title: 'renamed', status: 'done' });
		expect(updated?.title).toBe('renamed');
		expect(updated?.status).toBe('done');
		expect(deleteItem(item.id)).toBe(true);
		expect(getItem(item.id)).toBeNull();
	});

	it('deletes an item together with its threads, messages, decisions, agent tasks, and edges — concepts survive', async () => {
		const {
			createItem,
			deleteItem,
			getItem,
			createThread,
			getThread,
			createMessage,
			listMessages,
			createDecision,
			getDecision,
			createAgentTask,
			listAgentTasks,
			createConcept,
			getConcept,
			createEdge,
			listEdges
		} = await import('../lib/store.js');
		const item = createItem({ title: 'anchor' });
		const other = createItem({ title: 'other' });
		const thread = createThread('Discussion', item.id);
		createMessage({ thread_id: thread.id, content: 'first message' });
		createMessage({ thread_id: thread.id, content: 'second message' });
		const decision = createDecision({ item_id: item.id, question: 'Which path?', options: ['A', 'B'], choice: 'A' });
		const task = createAgentTask({ item_id: item.id, prompt: 'do the thing' });
		const concept = createConcept({ name: 'surviving-concept', item_id: item.id });
		const edge = createEdge({ from_id: item.id, to_id: other.id, label: 'feeds' });

		expect(deleteItem(item.id)).toBe(true);

		expect(getItem(item.id)).toBeNull();
		expect(getThread(thread.id)).toBeNull();
		expect(listMessages(thread.id)).toHaveLength(0);
		expect(getDecision(decision.id)).toBeNull();
		expect(listAgentTasks().some((t) => t.id === task.id)).toBe(false);
		expect(listEdges().some((e) => e.id === edge.id)).toBe(false);
		const surviving = getConcept(concept.id);
		expect(surviving).not.toBeNull();
		expect(surviving?.item_id).toBeNull();
		// unrelated item untouched
		expect(getItem(other.id)).not.toBeNull();
	});

	it('rejects invalid input', async () => {
		const { validateCreateItem } = await import('../lib/store.js');
		expect(validateCreateItem({}).ok).toBe(false);
		expect(validateCreateItem({ title: 'ok' }).ok).toBe(true);
		expect(validateCreateItem({ title: 'ok', kind: 'nope' }).ok).toBe(false);
	});
});

describe('moveItem', () => {
	it('moves an item to another board', async () => {
		const { createItem, createBoard, moveItem, getItem } = await import('../lib/store.js');
		const b = createBoard('Roadmap');
		const item = createItem({ title: 'mover', kind: 'task', x: 5, y: 6 });
		const moved = moveItem(item.id, b.id);
		expect(moved?.board_id).toBe(b.id);
		expect(getItem(item.id)?.board_id).toBe(b.id);
		// position and content are preserved
		expect(moved?.x).toBe(5);
		expect(moved?.y).toBe(6);
		expect(moved?.kind).toBe('task');
	});

	it('returns 404 StoreError for an unknown board and null for an unknown item', async () => {
		const { createItem, moveItem, StoreError } = await import('../lib/store.js');
		const item = createItem({ title: 'x' });
		expect(() => moveItem(item.id, 'nope')).toThrow(StoreError);
		try {
			moveItem(item.id, 'nope');
			throw new Error('expected throw');
		} catch (e) {
			expect((e as { status: number }).status).toBe(404);
		}
		expect(moveItem('missing', 'default')).toBeNull();
	});

	it('moves edges that follow the item to the target board; cross-board edges keep their original board', async () => {
		const {
			createItem,
			createBoard,
			createEdge,
			moveItem,
			getEdge
		} = await import('../lib/store.js');
		const b = createBoard('Other');
		const a = createItem({ title: 'a' }); // default
		const sameBoard = createItem({ title: 'same', board_id: b.id }); // Other
		const otherBoard = createItem({ title: 'other' }); // default
		const eFollow = createEdge({ from_id: a.id, to_id: sameBoard.id }); // board 'default'
		const eCross = createEdge({ from_id: a.id, to_id: otherBoard.id, kind: 'relates_to' }); // board 'default'

		const moved = moveItem(a.id, b.id);
		expect(moved?.board_id).toBe(b.id);

		// sameBoard is on the target board, so the edge follows
		expect(getEdge(eFollow.id)?.board_id).toBe(b.id);
		// otherBoard stays on 'default', so the cross-board edge keeps its original board
		expect(getEdge(eCross.id)?.board_id).toBe('default');
	});

	it('moves edges incident via to_id as well', async () => {
		const { createItem, createBoard, createEdge, moveItem, getEdge } = await import('../lib/store.js');
		const b = createBoard('Other');
		const a = createItem({ title: 'a', board_id: b.id });
		const d = createItem({ title: 'd' }); // default
		const e = createEdge({ from_id: d.id, to_id: a.id });
		moveItem(d.id, b.id);
		expect(getEdge(e.id)?.board_id).toBe(b.id);
	});
});

describe('duplicateItem', () => {
	it('copies content with a new id, offset position, and same board', async () => {
		const { createItem, duplicateItem, getItem } = await import('../lib/store.js');
		const src = createItem({
			title: 'template',
			kind: 'plan',
			status: 'in_progress',
			body_md: 'the body',
			tags: ['t1', 't2'],
			x: 10,
			y: 20
		});
		const copy = duplicateItem(src.id);
		expect(copy).not.toBeNull();
		expect(copy?.id).not.toBe(src.id);
		expect(copy?.board_id).toBe(src.board_id);
		expect(copy?.kind).toBe(src.kind);
		expect(copy?.status).toBe(src.status);
		expect(copy?.tags).toEqual(src.tags);
		expect(copy?.body_md).toBe(src.body_md);
		expect(copy?.title).toBe('template');
		expect(copy?.x).toBe(40);
		expect(copy?.y).toBe(50);
		expect(getItem(src.id)).not.toBeNull();
	});

	it('honors target board and title suffix', async () => {
		const { createItem, createBoard, duplicateItem } = await import('../lib/store.js');
		const b = createBoard('Clone target');
		const src = createItem({ title: 'orig', x: 1, y: 2 });
		const copy = duplicateItem(src.id, { board_id: b.id, title_suffix: ' (copy)' });
		expect(copy?.board_id).toBe(b.id);
		expect(copy?.title).toBe('orig (copy)');
		expect(copy?.x).toBe(31);
		expect(copy?.y).toBe(32);
	});

	it('returns null for an unknown source and 404 StoreError for an unknown board', async () => {
		const { createItem, duplicateItem, StoreError } = await import('../lib/store.js');
		expect(duplicateItem('missing')).toBeNull();
		const src = createItem({ title: 'x' });
		expect(() => duplicateItem(src.id, { board_id: 'nope' })).toThrow(StoreError);
	});
});

describe('edges store', () => {
	it('creates and deletes edges with referential integrity', async () => {
		const { createItem, createEdge, listEdges, deleteEdge, deleteItem } = await import('../lib/store.js');
		const a = createItem({ title: 'a' });
		const b = createItem({ title: 'b' });
		const edge = createEdge({ from_id: a.id, to_id: b.id, label: 'feeds' });
		expect(listEdges()).toHaveLength(1);
		expect(deleteEdge(edge.id)).toBe(true);
		expect(listEdges()).toHaveLength(0);

		const edge2 = createEdge({ from_id: a.id, to_id: b.id });
		deleteItem(a.id);
		expect(listEdges().some((e) => e.id === edge2.id)).toBe(false);
	});

	it('rejects a second edge with the same (from_id, to_id, kind)', async () => {
		const { createItem, createEdge } = await import('../lib/store.js');
		const a = createItem({ title: 'a' });
		const b = createItem({ title: 'b' });
		createEdge({ from_id: a.id, to_id: b.id });
		expect(() => createEdge({ from_id: a.id, to_id: b.id })).toThrow(/UNIQUE constraint failed/);
		// a different kind for the same pair is allowed
		const other = createEdge({ from_id: a.id, to_id: b.id, kind: 'relates_to' });
		expect(other.kind).toBe('relates_to');
	});

	it('gets and updates an edge (kind/label/ends)', async () => {
		const { createItem, createEdge, getEdge, updateEdge, getItem } = await import('../lib/store.js');
		const a = createItem({ title: 'a' });
		const b = createItem({ title: 'b' });
		const c = createItem({ title: 'c' });
		const edge = createEdge({ from_id: a.id, to_id: b.id, kind: 'depends_on', label: 'needs' });

		expect(getEdge(edge.id)).toEqual(edge);
		expect(getEdge('missing')).toBeNull();

		const updated = updateEdge(edge.id, { kind: 'blocks', label: 'stops' });
		expect(updated?.kind).toBe('blocks');
		expect(updated?.label).toBe('stops');
		expect(updated?.from_id).toBe(a.id);
		expect(updated?.to_id).toBe(b.id);
		expect(getEdge(edge.id)?.kind).toBe('blocks');

		const moved = updateEdge(edge.id, { from_id: c.id });
		expect(moved?.from_id).toBe(c.id);
		expect(moved?.to_id).toBe(b.id);
		expect(moved?.kind).toBe('blocks');
		expect(getItem(a.id)).not.toBeNull();
	});

	it('updateEdge validates and returns null for a missing edge', async () => {
		const { createItem, createEdge, updateEdge, StoreError } = await import('../lib/store.js');
		const a = createItem({ title: 'a' });
		const b = createItem({ title: 'b' });
		const edge = createEdge({ from_id: a.id, to_id: b.id });

		expect(updateEdge('missing', { label: 'x' })).toBeNull();
		expect(() => updateEdge(edge.id, { kind: '' })).toThrow(StoreError);
		expect(() => updateEdge(edge.id, { kind: 42 })).toThrow(StoreError);
		expect(() => updateEdge(edge.id, { from_id: 'missing' })).toThrow(/from item not found/);
		expect(() => updateEdge(edge.id, { to_id: 'missing' })).toThrow(/to item not found/);
	});

	it('updateEdge colliding with the unique (from_id, to_id, kind) index throws a UNIQUE constraint error', async () => {
		const { createItem, createEdge, updateEdge } = await import('../lib/store.js');
		const a = createItem({ title: 'a' });
		const b = createItem({ title: 'b' });
		const first = createEdge({ from_id: a.id, to_id: b.id });
		const second = createEdge({ from_id: a.id, to_id: b.id, kind: 'relates_to' });

		expect(() => updateEdge(second.id, { kind: 'depends_on' })).toThrow(
			/UNIQUE constraint failed/
		);
		// first edge untouched
		expect((await import('../lib/store.js')).getEdge(first.id)?.kind).toBe('depends_on');
	});
});

describe('messages store', () => {
	it('deletes a message and keeps the FTS index consistent', async () => {
		const { createThread, createMessage, listMessages, deleteMessage } =
			await import('../lib/store.js');
		const { search } = await import('../lib/search.js');
		const thread = createThread('t');
		const keep = createMessage({ thread_id: thread.id, content: 'quantum flibber kept' });
		const gone = createMessage({ thread_id: thread.id, content: 'quantum flibber deleted' });

		expect(listMessages(thread.id)).toHaveLength(2);
		expect(search('flibber', { source: 'message' }).map((h) => h.id)).toContain(gone.id);

		expect(deleteMessage(thread.id, gone.id)).toBe(true);
		expect(deleteMessage(thread.id, 'missing')).toBe(false);

		expect(listMessages(thread.id).map((m) => m.id)).toEqual([keep.id]);
		expect(search('flibber', { source: 'message' }).map((h) => h.id)).not.toContain(gone.id);
	});

	it('paginates same-created_at messages by rowid without skips or duplicates', async () => {
		const { getDb } = await import('../lib/db.js');
		const { createThread, createMessage, listMessages } = await import('../lib/store.js');
		const db = getDb();
		const thread = createThread('t');
		const m1 = createMessage({ thread_id: thread.id, content: 'one' });
		const m2 = createMessage({ thread_id: thread.id, content: 'two' });
		const m3 = createMessage({ thread_id: thread.id, content: 'three' });
		// force identical millisecond timestamps (the tie case the old cursor broke on)
		db.prepare('UPDATE messages SET created_at = ? WHERE thread_id = ?').run(
			'2026-01-01T00:00:00.000Z',
			thread.id
		);

		expect(listMessages(thread.id).map((m) => m.id)).toEqual([m1.id, m2.id, m3.id]);
		// old scheme: created_at < created_at(cursor) excluded ties, so page 2 was empty
		expect(listMessages(thread.id, 1, m3.id).map((m) => m.id)).toEqual([m2.id]);
		expect(listMessages(thread.id, 1, m2.id).map((m) => m.id)).toEqual([m1.id]);
		expect(listMessages(thread.id, 1, m1.id)).toEqual([]);
	});
});

describe('listAgentTasks filters', () => {
	it('filters by item_id and status', async () => {
		const { createItem, createAgentTask, listAgentTasks } = await import('../lib/store.js');
		const a = createItem({ title: 'a' });
		const b = createItem({ title: 'b' });
		const running = createAgentTask({ item_id: a.id, prompt: 'run' });
		const done = createAgentTask({ item_id: a.id, prompt: 'done one' });
		const other = createAgentTask({ item_id: b.id, prompt: 'other' });
		const { finishAgentTask } = await import('../lib/store.js');
		finishAgentTask(done.id, 'succeeded');

		expect(listAgentTasks()).toHaveLength(3);
		// sort both sides: same-millisecond ties have no guaranteed DB order
		expect(listAgentTasks(50, { item_id: a.id }).map((t) => t.id).sort()).toEqual([running.id, done.id].sort());
		expect(listAgentTasks(50, { status: 'succeeded' }).map((t) => t.id)).toEqual([done.id]);
		expect(listAgentTasks(50, { item_id: a.id, status: 'running' }).map((t) => t.id)).toEqual([running.id]);
		expect(listAgentTasks(50, { item_id: a.id, status: 'succeeded' }).map((t) => t.id)).toEqual([done.id]);
		// limit still applies with filters
		expect(listAgentTasks(1, { item_id: a.id })).toHaveLength(1);
		expect(listAgentTasks(1, { item_id: 'missing' })).toEqual([]);
		expect(listAgentTasks(10, { status: 'canceled' })).toEqual([]);
		// unrelated task untouched by filters
		expect(listAgentTasks(50, { item_id: b.id }).map((t) => t.id)).toEqual([other.id]);
	});
});

describe('decision uniqueness', () => {
	it('rejects a second active decision with the same (item_id, question)', async () => {
		const { createItem, createDecision } = await import('../lib/store.js');
		const item = createItem({ title: 'anchor' });
		createDecision({ item_id: item.id, question: 'Which path?', choice: 'A' });
		expect(() => createDecision({ item_id: item.id, question: 'Which path?', choice: 'B' })).toThrow(
			/UNIQUE constraint failed/
		);
		// a different question for the same item is allowed
		const other = createDecision({ item_id: item.id, question: 'Which color?', choice: 'red' });
		expect(other.question).toBe('Which color?');
	});

	it('allows a superseded decision with the same question, followed by a new active one', async () => {
		const { createItem, createDecision, updateDecision, getDecision } = await import('../lib/store.js');
		const item = createItem({ title: 'anchor' });
		const first = createDecision({ item_id: item.id, question: 'Which path?', choice: 'A' });
		updateDecision(first.id, { status: 'superseded' });
		expect(getDecision(first.id)?.status).toBe('superseded');
		const second = createDecision({ item_id: item.id, question: 'Which path?', choice: 'B' });
		expect(second.status).toBe('active');
		expect(second.choice).toBe('B');
	});
});
