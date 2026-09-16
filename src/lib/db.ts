import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export type ItemKind = 'note' | 'concept' | 'task' | 'plan' | 'decision' | 'agent_task';
export type ItemStatus = 'open' | 'in_progress' | 'done' | 'blocked';
export type MessageRole = 'user' | 'agent' | 'subagent' | 'system';
export type DecisionStatus = 'active' | 'superseded';
export type AgentTaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface Item {
	id: string;
	kind: ItemKind;
	title: string;
	body_md: string;
	x: number;
	y: number;
	w: number | null;
	h: number | null;
	status: ItemStatus;
	tags: string[];
	parent_id: string | null;
	created_at: string;
	updated_at: string;
}

export interface Edge {
	id: string;
	from_id: string;
	to_id: string;
	kind: string;
	label: string;
	created_at: string;
}

export interface Thread {
	id: string;
	title: string;
	item_id: string | null;
	created_at: string;
}

export interface Message {
	id: string;
	thread_id: string;
	role: MessageRole;
	content: string;
	meta: string | null;
	created_at: string;
}

export interface Decision {
	id: string;
	item_id: string | null;
	question: string;
	options: string[];
	choice: string | null;
	rationale: string;
	status: DecisionStatus;
	created_at: string;
	updated_at: string;
}

export interface Concept {
	id: string;
	name: string;
	definition: string;
	details_md: string;
	source: string | null;
	item_id: string | null;
	created_at: string;
	updated_at: string;
}

export interface AgentTask {
	id: string;
	item_id: string | null;
	prompt: string;
	agent: string | null;
	model: string | null;
	status: AgentTaskStatus;
	session_id: string | null;
	transcript: string | null;
	started_at: string | null;
	finished_at: string | null;
	created_at: string;
}

export const ITEM_KINDS: ItemKind[] = ['note', 'concept', 'task', 'plan', 'decision', 'agent_task'];
export const ITEM_STATUSES: ItemStatus[] = ['open', 'in_progress', 'done', 'blocked'];

export function newId(): string {
	return randomUUID();
}

let db: DatabaseSync | null = null;

export function dbPath(): string {
	return process.env.BUILDBOARD_DB ?? path.join(process.cwd(), 'data', 'buildboard.db');
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

const MIGRATIONS = [
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
	`CREATE INDEX IF NOT EXISTS idx_items_parent ON items(parent_id)`
];

const MIGRATION_NAMES = MIGRATIONS.map((_, i) => `m${String(i).padStart(3, '0')}`);

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
	MIGRATIONS.forEach((sql, i) => {
		const name = MIGRATION_NAMES[i];
		if (!applied.has(name)) {
			database.exec(sql);
			database.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
		}
	});
	database.exec('COMMIT');
}
