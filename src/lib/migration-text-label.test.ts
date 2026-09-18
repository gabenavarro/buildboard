import { DatabaseSync } from 'node:sqlite';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupDb, cleanupTempDirs, freshDb } from '../test/testdb.js';

let dbFile: string;

beforeEach(() => {
	dbFile = freshDb();
});

afterEach(() => {
	cleanupDb();
});

afterAll(() => {
	cleanupTempDirs();
});

describe('text-label migration (rebuild items CHECK)', () => {
	it('upgrades an old-schema DB with data, keeps rows, allows kind=text, and re-syncs FTS', async () => {
		const { MIGRATIONS, getDb } = await import('./db.js');
		const TEXT_MIG_COUNT = 3;
		const oldMigrations = MIGRATIONS.slice(0, -TEXT_MIG_COUNT);

		// Seed a pre-text database: apply every migration except the text rebuild,
		// under its positional name (matching migrate() naming).
		const seed = new DatabaseSync(dbFile);
		seed.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m:%H:%SfZ','now'))
		)`);
		oldMigrations.forEach((sql, i) => {
			seed.exec(sql);
			seed.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(`m${String(i).padStart(3, '0')}`);
		});
		// Seed real rows (FTS triggers from the old schema will index them).
		seed
			.prepare('INSERT INTO items (id, kind, title, body_md, x, y, board_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
			.run('a', 'note', 'Alpha', 'body alpha', 10, 10, 'default');
		seed
			.prepare('INSERT INTO items (id, kind, title, body_md, x, y, board_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
			.run('b', 'task', 'Beta', 'body beta', 200, 10, 'default');
		seed.prepare('INSERT INTO edges (id, from_id, to_id, board_id) VALUES (?, ?, ?, ?)').run('e1', 'a', 'b', 'default');
		seed.close();

		// Opening through getDb() must apply only the missing (text) migrations.
		const db = getDb();

		const rows = db.prepare('SELECT id, kind, title, body_md FROM items ORDER BY id').all() as {
			id: string;
			kind: string;
			title: string;
			body_md: string;
		}[];
		expect(rows).toHaveLength(2);
		expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
		expect(rows[0].title).toBe('Alpha');
		expect(rows[0].body_md).toBe('body alpha');

		// kind=text is now allowed by the CHECK constraint.
		db.prepare("INSERT INTO items (id, kind, title, body_md, board_id) VALUES ('t', 'text', 'Label', 'hello', 'default')").run();
		const textRow = db.prepare("SELECT kind, body_md FROM items WHERE id = 't'").get() as { kind: string; body_md: string };
		expect(textRow.kind).toBe('text');
		expect(textRow.body_md).toBe('hello');

		// FTS was re-synced after the rowid-changing rebuild.
		const fts = db.prepare("SELECT title FROM fts_items WHERE fts_items MATCH 'alpha'").all() as { title: string }[];
		expect(fts).toHaveLength(1);
		expect(fts[0].title).toBe('Alpha');

		// Edges survived the rebuild.
		const edges = db.prepare('SELECT from_id, to_id FROM edges WHERE id = ?').all('e1') as { from_id: string; to_id: string }[];
		expect(edges).toHaveLength(1);
		expect(edges[0]).toEqual({ from_id: 'a', to_id: 'b' });

		// Item indexes were recreated.
		const indexes = new Set(
			(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]).map((r) => r.name)
		);
		for (const name of ['idx_items_parent', 'idx_items_board', 'idx_items_kind', 'idx_items_status']) {
			expect(indexes.has(name)).toBe(true);
		}
	});
});
