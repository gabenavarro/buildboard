import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpRoot = mkdtempSync(path.join(tmpdir(), 'buildboard-test-'));
let dbFile: string;

beforeEach(() => {
	dbFile = path.join(tmpRoot, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
	process.env.BUILDBOARD_DB = dbFile;
	vi.resetModules();
});

afterEach(() => {
	delete process.env.BUILDBOARD_DB;
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
