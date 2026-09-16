import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpRoot = mkdtempSync(path.join(tmpdir(), 'buildboard-mig-'));
let dbFile: string;

beforeEach(() => {
	dbFile = path.join(tmpRoot, `upgrade-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
	process.env.BUILDBOARD_DB = dbFile;
	vi.resetModules();
});

afterEach(() => {
	delete process.env.BUILDBOARD_DB;
});

const NEW_MIGRATION_SQL = [
	'CREATE INDEX IF NOT EXISTS idx_threads_item ON threads(item_id)',
	'CREATE INDEX IF NOT EXISTS idx_decisions_item ON decisions(item_id)',
	'CREATE INDEX IF NOT EXISTS idx_concepts_item ON concepts(item_id)',
	'CREATE INDEX IF NOT EXISTS idx_agent_tasks_item ON agent_tasks(item_id)',
	'CREATE INDEX IF NOT EXISTS idx_items_kind ON items(kind)',
	'CREATE INDEX IF NOT EXISTS idx_items_status ON items(status)',
	"CREATE UNIQUE INDEX IF NOT EXISTS idx_decisions_active ON decisions(item_id, question) WHERE status = 'active' AND item_id IS NOT NULL",
	'CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_unique ON edges(from_id, to_id, kind)'
];

describe('migration upgrade path', () => {
	it('applies the new index migrations on top of a DB created by the previous schema', async () => {
		const { MIGRATIONS } = await import('./db.js');
		expect(NEW_MIGRATION_SQL).toHaveLength(8);

		// Simulate an old-schema database: apply every migration except the new ones,
		// recording each under its positional name (matching the migrate() naming).
		const seed = new DatabaseSync(dbFile);
		seed.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
		)`);
		MIGRATIONS.forEach((sql, i) => {
			if (NEW_MIGRATION_SQL.includes(sql)) return;
			seed.exec(sql);
			seed.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(`m${String(i).padStart(3, '0')}`);
		});
		seed.close();

		// Opening the DB through the store must run only the missing (new) migrations.
		const { getDb } = await import('./db.js');
		const db = getDb();

		const applied = (
			db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]
		).map((r) => r.name);
		expect(new Set(applied).size).toBe(applied.length);
		expect(applied).toHaveLength(MIGRATIONS.length);

		const indexes = new Set(
			(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]).map(
				(r) => r.name
			)
		);
		for (const name of [
			'idx_threads_item',
			'idx_decisions_item',
			'idx_concepts_item',
			'idx_agent_tasks_item',
			'idx_items_kind',
			'idx_items_status',
			'idx_decisions_active',
			'idx_edges_unique'
		]) {
			expect(indexes.has(name)).toBe(true);
		}

		// Old indexes from the previous schema are intact and not duplicated.
		for (const name of [
			'idx_edges_from',
			'idx_edges_to',
			'idx_messages_thread',
			'idx_items_parent',
			'idx_items_board',
			'idx_edges_board'
		]) {
			expect(indexes.has(name)).toBe(true);
		}
	});
});
