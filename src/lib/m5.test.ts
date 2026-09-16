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

describe('boards', () => {
	it('has a default board and supports create/rename/delete', async () => {
		const { listBoards, createBoard, renameBoard, deleteBoard, getBoard } = await import('../lib/store.js');

		const initial = listBoards();
		expect(initial.some((b) => b.id === 'default' && b.name === 'Main board')).toBe(true);

		const b = createBoard('Roadmap');
		expect(getBoard(b.id)?.name).toBe('Roadmap');

		const renamed = renameBoard(b.id, 'Roadmap v2');
		expect(renamed?.name).toBe('Roadmap v2');

		expect(deleteBoard(b.id)).toBe(true);
		expect(getBoard(b.id)).toBeNull();
	});

	it('reports per-board item counts in listBoards', async () => {
		const { listBoards, createBoard, createItem } = await import('../lib/store.js');
		const b = createBoard('counted');
		createItem({ title: 'one', board_id: b.id });
		createItem({ title: 'two', board_id: b.id });

		const boards = listBoards();
		expect(boards.find((x) => x.id === b.id)?.item_count).toBe(2);
		expect(boards.find((x) => x.id === 'default')?.item_count).toBe(0);
	});

	it('refuses to delete the default board or a board with items', async () => {
		const { createBoard, deleteBoard, createItem } = await import('../lib/store.js');
		const b = createBoard('full');
		createItem({ title: 'x', board_id: b.id });
		expect(deleteBoard(b.id)).toBe(false);
		expect(deleteBoard('default')).toBe(false);
	});

	it('scopes items and edges by board', async () => {
		const { createItem, createEdge, listItems, listEdges } = await import('../lib/store.js');
		const b = (await import('../lib/store.js')).createBoard('scoped');

		const a = createItem({ title: 'a', board_id: b.id });
		const c = createItem({ title: 'c' }); // default board
		createEdge({ from_id: a.id, to_id: a.id, board_id: b.id });
		createEdge({ from_id: c.id, to_id: c.id });

		expect(listItems({ board_id: b.id })).toHaveLength(1);
		expect(listItems({ board_id: 'default' })).toHaveLength(1);
		expect(listItems()).toHaveLength(2);

		expect(listEdges(b.id)).toHaveLength(1);
		expect(listEdges('default')).toHaveLength(1);
	});
});
