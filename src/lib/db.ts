import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// Server-only module. Domain types/constants live in ./types.js (client-safe);
// re-exported here for existing server-side imports.
export * from './types.js';

export function newId(): string {
	return randomUUID();
}

export function newRef(): string {
	return randomBytes(2).toString('hex');
}

let db: DatabaseSync | null = null;

/**
 * Walk up from `startDir` to the nearest directory containing a package.json.
 * Returns the starting directory itself if no package.json is found above it.
 */
export function findRepoRoot(startDir: string): string {
	let dir = startDir;
	for (;;) {
		if (existsSync(path.join(dir, 'package.json'))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) return dir;
		dir = parent;
	}
}

/**
 * Resolve the buildboard repo root from this module's own location so the
 * result is stable regardless of process.cwd(). Works both in the SvelteKit
 * app (src/lib) and in the esbuild MCP bundle (dist/mcp/server.mjs).
 */
export function repoRoot(): string {
	const start = import.meta.dirname ?? process.cwd();
	return findRepoRoot(start);
}

export function dbPath(): string {
	return process.env.BUILDBOARD_DB ?? path.join(repoRoot(), 'data', 'buildboard.db');
}

export function getDb(): DatabaseSync {
	if (!db) {
		const p = dbPath();
		mkdirSync(path.dirname(p), { recursive: true });
		db = new DatabaseSync(p);
		db.exec('PRAGMA journal_mode = WAL;');
		db.exec('PRAGMA foreign_keys = ON;');
		migrate(db);
	}
	return db;
}

export const MIGRATIONS = [
	`CREATE TABLE IF NOT EXISTS items (
		id TEXT PRIMARY KEY,
		kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note','concept','task','plan','decision','agent_task')),
		title TEXT NOT NULL,
		body_md TEXT NOT NULL DEFAULT '',
		x REAL NOT NULL DEFAULT 0,
		y REAL NOT NULL DEFAULT 0,
		w REAL,
		h REAL,
		status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','blocked')),
		tags TEXT NOT NULL DEFAULT '[]',
		parent_id TEXT REFERENCES items(id) ON DELETE SET NULL,
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
		updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
	)`,
	`CREATE TABLE IF NOT EXISTS edges (
		id TEXT PRIMARY KEY,
		from_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
		to_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
		kind TEXT NOT NULL DEFAULT 'depends_on',
		label TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
	)`,
	`CREATE TABLE IF NOT EXISTS threads (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
	)`,
	`CREATE TABLE IF NOT EXISTS messages (
		id TEXT PRIMARY KEY,
		thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
		role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','agent','subagent','system')),
		content TEXT NOT NULL,
		meta TEXT,
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
	)`,
	`CREATE TABLE IF NOT EXISTS decisions (
		id TEXT PRIMARY KEY,
		item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
		question TEXT NOT NULL,
		options TEXT NOT NULL DEFAULT '[]',
		choice TEXT,
		rationale TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded')),
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
		updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
	)`,
	`CREATE TABLE IF NOT EXISTS concepts (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL UNIQUE,
		definition TEXT NOT NULL DEFAULT '',
		details_md TEXT NOT NULL DEFAULT '',
		source TEXT,
		item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
		updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
	)`,
	`CREATE TABLE IF NOT EXISTS agent_tasks (
		id TEXT PRIMARY KEY,
		item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
		prompt TEXT NOT NULL,
		agent TEXT,
		model TEXT,
		status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed','canceled')),
		session_id TEXT,
		transcript TEXT,
		started_at TEXT,
		finished_at TEXT,
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
	)`,
	`CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id)`,
	`CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id)`,
	`CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id)`,
	`CREATE INDEX IF NOT EXISTS idx_items_parent ON items(parent_id)`,
	// FTS5 full-text indexes (external content, kept in sync by triggers)
	`CREATE VIRTUAL TABLE IF NOT EXISTS fts_items USING fts5(title, body_md, content='items', content_rowid='rowid')`,
	`CREATE VIRTUAL TABLE IF NOT EXISTS fts_decisions USING fts5(question, rationale, content='decisions', content_rowid='rowid')`,
	`CREATE VIRTUAL TABLE IF NOT EXISTS fts_concepts USING fts5(name, definition, details_md, content='concepts', content_rowid='rowid')`,
	`CREATE VIRTUAL TABLE IF NOT EXISTS fts_messages USING fts5(content, content='messages', content_rowid='rowid')`,
	`CREATE TRIGGER IF NOT EXISTS items_fts_ai AFTER INSERT ON items BEGIN
		INSERT INTO fts_items(rowid, title, body_md) VALUES (new.rowid, new.title, new.body_md);
	END`,
	`CREATE TRIGGER IF NOT EXISTS items_fts_ad AFTER DELETE ON items BEGIN
		INSERT INTO fts_items(fts_items, rowid, title, body_md) VALUES ('delete', old.rowid, old.title, old.body_md);
	END`,
	`CREATE TRIGGER IF NOT EXISTS items_fts_au AFTER UPDATE ON items BEGIN
		INSERT INTO fts_items(fts_items, rowid, title, body_md) VALUES ('delete', old.rowid, old.title, old.body_md);
		INSERT INTO fts_items(rowid, title, body_md) VALUES (new.rowid, new.title, new.body_md);
	END`,
	`CREATE TRIGGER IF NOT EXISTS decisions_fts_ai AFTER INSERT ON decisions BEGIN
		INSERT INTO fts_decisions(rowid, question, rationale) VALUES (new.rowid, new.question, new.rationale);
	END`,
	`CREATE TRIGGER IF NOT EXISTS decisions_fts_ad AFTER DELETE ON decisions BEGIN
		INSERT INTO fts_decisions(fts_decisions, rowid, question, rationale) VALUES ('delete', old.rowid, old.question, old.rationale);
	END`,
	`CREATE TRIGGER IF NOT EXISTS decisions_fts_au AFTER UPDATE ON decisions BEGIN
		INSERT INTO fts_decisions(fts_decisions, rowid, question, rationale) VALUES ('delete', old.rowid, old.question, old.rationale);
		INSERT INTO fts_decisions(rowid, question, rationale) VALUES (new.rowid, new.question, new.rationale);
	END`,
	`CREATE TRIGGER IF NOT EXISTS concepts_fts_ai AFTER INSERT ON concepts BEGIN
		INSERT INTO fts_concepts(rowid, name, definition, details_md) VALUES (new.rowid, new.name, new.definition, new.details_md);
	END`,
	`CREATE TRIGGER IF NOT EXISTS concepts_fts_ad AFTER DELETE ON concepts BEGIN
		INSERT INTO fts_concepts(fts_concepts, rowid, name, definition, details_md) VALUES ('delete', old.rowid, old.name, old.definition, old.details_md);
	END`,
	`CREATE TRIGGER IF NOT EXISTS concepts_fts_au AFTER UPDATE ON concepts BEGIN
		INSERT INTO fts_concepts(fts_concepts, rowid, name, definition, details_md) VALUES ('delete', old.rowid, old.name, old.definition, old.details_md);
		INSERT INTO fts_concepts(rowid, name, definition, details_md) VALUES (new.rowid, new.name, new.definition, new.details_md);
	END`,
	`CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
		INSERT INTO fts_messages(rowid, content) VALUES (new.rowid, new.content);
	END`,
	`CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
		INSERT INTO fts_messages(fts_messages, rowid, content) VALUES ('delete', old.rowid, old.content);
	END`,
	`CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
		INSERT INTO fts_messages(fts_messages, rowid, content) VALUES ('delete', old.rowid, old.content);
		INSERT INTO fts_messages(rowid, content) VALUES (new.rowid, new.content);
	END`,
	// Multi-board support
	`CREATE TABLE IF NOT EXISTS boards (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
	)`,
	`INSERT OR IGNORE INTO boards (id, name) VALUES ('default', 'Main board')`,
	`ALTER TABLE items ADD COLUMN board_id TEXT NOT NULL DEFAULT 'default'`,
	`ALTER TABLE edges ADD COLUMN board_id TEXT NOT NULL DEFAULT 'default'`,
	`CREATE INDEX IF NOT EXISTS idx_items_board ON items(board_id)`,
	`CREATE INDEX IF NOT EXISTS idx_edges_board ON edges(board_id)`,
	// Per-item hot-path indexes
	`CREATE INDEX IF NOT EXISTS idx_threads_item ON threads(item_id)`,
	`CREATE INDEX IF NOT EXISTS idx_decisions_item ON decisions(item_id)`,
	`CREATE INDEX IF NOT EXISTS idx_concepts_item ON concepts(item_id)`,
	`CREATE INDEX IF NOT EXISTS idx_agent_tasks_item ON agent_tasks(item_id)`,
	`CREATE INDEX IF NOT EXISTS idx_items_kind ON items(kind)`,
	`CREATE INDEX IF NOT EXISTS idx_items_status ON items(status)`,
	// Integrity guards: one active decision per (item, question); no duplicate edges
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_decisions_active ON decisions(item_id, question) WHERE status = 'active' AND item_id IS NOT NULL`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_unique ON edges(from_id, to_id, kind)`,
	// Free-text labels: rebuild items so the kind CHECK allows 'text'.
	// SQLite cannot alter a CHECK constraint in place, so we rebuild the
	// table (copy -> drop -> rename). Dropping items would cascade-delete
	// edges and null item_id on threads/decisions/concepts/agent_tasks, so
	// those dependents are backed up before the drop and restored after.
	// The FTS index is re-synced afterwards because rowids change on rebuild.
	`CREATE TABLE items_text_rebuild (
		id TEXT PRIMARY KEY,
		kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note','concept','task','plan','decision','agent_task','text')),
		title TEXT NOT NULL,
		body_md TEXT NOT NULL DEFAULT '',
		x REAL NOT NULL DEFAULT 0,
		y REAL NOT NULL DEFAULT 0,
		w REAL,
		h REAL,
		status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','blocked')),
		tags TEXT NOT NULL DEFAULT '[]',
		parent_id TEXT REFERENCES items(id) ON DELETE SET NULL,
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m:%H:%SfZ','now')),
		updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m:%H:%SfZ','now')),
		board_id TEXT NOT NULL DEFAULT 'default'
	);
	INSERT INTO items_text_rebuild (id, kind, title, body_md, x, y, w, h, status, tags, parent_id, created_at, updated_at, board_id)
		SELECT id, kind, title, body_md, x, y, w, h, status, tags, parent_id, created_at, updated_at, board_id FROM items;
	CREATE TABLE edges_bak AS SELECT * FROM edges;
	CREATE TABLE threads_bak AS SELECT * FROM threads;
	CREATE TABLE decisions_bak AS SELECT * FROM decisions;
	CREATE TABLE concepts_bak AS SELECT * FROM concepts;
	CREATE TABLE agent_tasks_bak AS SELECT * FROM agent_tasks`,
	`DROP TABLE items;
	ALTER TABLE items_text_rebuild RENAME TO items;
	CREATE INDEX idx_items_parent ON items(parent_id);
	CREATE INDEX idx_items_board ON items(board_id);
	CREATE INDEX idx_items_kind ON items(kind);
	CREATE INDEX idx_items_status ON items(status);
	CREATE TRIGGER items_fts_ai AFTER INSERT ON items BEGIN
		INSERT INTO fts_items(rowid, title, body_md) VALUES (new.rowid, new.title, new.body_md);
	END;
	CREATE TRIGGER items_fts_ad AFTER DELETE ON items BEGIN
		INSERT INTO fts_items(fts_items, rowid, title, body_md) VALUES ('delete', old.rowid, old.title, old.body_md);
	END;
	CREATE TRIGGER items_fts_au AFTER UPDATE ON items BEGIN
		INSERT INTO fts_items(fts_items, rowid, title, body_md) VALUES ('delete', old.rowid, old.title, old.body_md);
		INSERT INTO fts_items(rowid, title, body_md) VALUES (new.rowid, new.title, new.body_md);
	END`,
	`INSERT INTO edges SELECT * FROM edges_bak;
	INSERT INTO threads SELECT * FROM threads_bak;
	INSERT INTO decisions SELECT * FROM decisions_bak;
	INSERT INTO concepts SELECT * FROM concepts_bak;
	INSERT INTO agent_tasks SELECT * FROM agent_tasks_bak;
	DROP TABLE edges_bak;
	DROP TABLE threads_bak;
	DROP TABLE decisions_bak;
	DROP TABLE concepts_bak;
	DROP TABLE agent_tasks_bak;
	INSERT INTO fts_items(fts_items) VALUES('rebuild')`,
	// Short refs (4 hex) addressing items/decisions/concepts from chat, board, and agents
	`ALTER TABLE items ADD COLUMN ref TEXT;
	ALTER TABLE decisions ADD COLUMN ref TEXT;
	ALTER TABLE concepts ADD COLUMN ref TEXT;
	CREATE UNIQUE INDEX IF NOT EXISTS idx_items_ref ON items(ref) WHERE ref IS NOT NULL;
	CREATE UNIQUE INDEX IF NOT EXISTS idx_decisions_ref ON decisions(ref) WHERE ref IS NOT NULL;
	CREATE UNIQUE INDEX IF NOT EXISTS idx_concepts_ref ON concepts(ref) WHERE ref IS NOT NULL;`
];

const MIGRATION_NAMES = MIGRATIONS.map((_, i) => `m${String(i).padStart(3, '0')}`);

const REF_TABLES = ['items', 'decisions', 'concepts'] as const;

function refExists(database: DatabaseSync, ref: string): boolean {
	for (const table of REF_TABLES) {
		if (database.prepare(`SELECT 1 FROM ${table} WHERE ref = ?`).get(ref)) return true;
	}
	return false;
}

function backfillRefs(database: DatabaseSync): void {
	for (const table of REF_TABLES) {
		const rows = database.prepare(`SELECT id FROM ${table} WHERE ref IS NULL`).all() as { id: string }[];
		const set = database.prepare(`UPDATE ${table} SET ref = ? WHERE id = ?`);
		for (const row of rows) {
			let ref = newRef();
			while (refExists(database, ref)) ref = newRef();
			set.run(ref, row.id);
		}
	}
}

function migrate(database: DatabaseSync): void {
	database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
	)`);
	database.exec('BEGIN');
	const applied = new Set(
		database.prepare('SELECT name FROM schema_migrations').all().map((r) => (r.name as string))
	);
	const needsRefBackfill = !applied.has(MIGRATION_NAMES[MIGRATIONS.length - 1]);
	MIGRATIONS.forEach((sql, i) => {
		const name = MIGRATION_NAMES[i];
		if (!applied.has(name)) {
			database.exec(sql);
			database.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
		}
	});
	if (needsRefBackfill) backfillRefs(database);
	database.exec('COMMIT');
}
