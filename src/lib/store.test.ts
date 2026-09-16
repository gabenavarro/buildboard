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
});
