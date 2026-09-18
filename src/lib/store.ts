import type { DatabaseSync } from 'node:sqlite';
import { getDb, newId, newRef, ITEM_KINDS, ITEM_STATUSES } from './db.js';
import type {
	Item,
	Edge,
	ItemKind,
	ItemStatus,
	Thread,
	Message,
	MessageRole,
	Decision,
	DecisionStatus,
	Concept,
	AgentTask,
	AgentTaskStatus,
	Board,
	BoardWithCount
} from './db.js';

/**
 * Expected store failure carrying an HTTP status. Thrown by store
 * validation (existence, duplicates, enums) and mapped to a JSON error
 * response by the API layer. The MCP server surfaces it as a plain error.
 */
export class StoreError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'StoreError';
		this.status = status;
	}
}

const DECISION_STATUSES: DecisionStatus[] = ['active', 'superseded'];

const REF_TABLES = ['items', 'decisions', 'concepts'] as const;

function refTakenIn(db: DatabaseSync, table: (typeof REF_TABLES)[number], ref: string): boolean {
	return db.prepare(`SELECT 1 FROM ${table} WHERE ref = ?`).get(ref) !== undefined;
}

function refTaken(db: DatabaseSync, ref: string): boolean {
	for (const table of REF_TABLES) {
		if (refTakenIn(db, table, ref)) return true;
	}
	return false;
}

function newUniqueRef(db: DatabaseSync): string {
	for (let i = 0; i < 10; i++) {
		const ref = newRef();
		if (!refTaken(db, ref)) return ref;
	}
	return newRef();
}

function allocateRef(db: DatabaseSync, ref: string | undefined, table: (typeof REF_TABLES)[number]): string {
	if (ref === undefined) return newUniqueRef(db);
	if (refTakenIn(db, table, ref)) throw new StoreError(409, `ref already in use: ${ref}`);
	return ref;
}

function insertWithRef<T>(
	db: DatabaseSync,
	refHint: string | undefined,
	table: (typeof REF_TABLES)[number],
	insert: (ref: string) => T
): T {
	try {
		return insert(allocateRef(db, refHint, table));
	} catch (e) {
		if (!(e instanceof Error && /UNIQUE constraint failed/i.test(e.message) && /ref/.test(e.message))) {
			throw e;
		}
		return insert(allocateRef(db, refHint, table));
	}
}

function parseTags(raw: string): string[] {
	try {
		const v = JSON.parse(raw);
		return Array.isArray(v) ? v.filter((t) => typeof t === 'string') : [];
	} catch {
		return [];
	}
}

function rowToItem(row: Record<string, unknown>): Item {
	return {
		id: row.id as string,
		kind: row.kind as ItemKind,
		title: row.title as string,
		body_md: row.body_md as string,
		x: row.x as number,
		y: row.y as number,
		w: (row.w as number | null) ?? null,
		h: (row.h as number | null) ?? null,
		status: row.status as ItemStatus,
		tags: parseTags(row.tags as string),
		parent_id: (row.parent_id as string | null) ?? null,
		board_id: (row.board_id as string) ?? 'default',
		ref: (row.ref as string | null) ?? null,
		pct: (row.pct as number | null) ?? null,
		created_at: row.created_at as string,
		updated_at: row.updated_at as string
	};
}

export interface CreateItemInput {
	kind?: ItemKind;
	title: string;
	body_md?: string;
	x?: number;
	y?: number;
	w?: number | null;
	h?: number | null;
	status?: ItemStatus;
	tags?: string[];
	parent_id?: string | null;
	board_id?: string;
	ref?: string;
}

export function validateCreateItem(input: Record<string, unknown>): { ok: true; value: CreateItemInput } | { ok: false; error: string } {
	if (typeof input.title !== 'string' || input.title.trim().length === 0) {
		return { ok: false, error: 'title is required' };
	}
	const kind = (input.kind ?? 'note') as ItemKind;
	if (!ITEM_KINDS.includes(kind)) {
		return { ok: false, error: `kind must be one of: ${ITEM_KINDS.join(', ')}` };
	}
	const status = (input.status ?? 'open') as ItemStatus;
	if (!ITEM_STATUSES.includes(status)) {
		return { ok: false, error: `status must be one of: ${ITEM_STATUSES.join(', ')}` };
	}
	const tags = input.tags;
	if (tags !== undefined && !Array.isArray(tags)) {
		return { ok: false, error: 'tags must be an array of strings' };
	}
	return {
		ok: true,
		value: {
			kind,
			title: input.title,
			body_md: typeof input.body_md === 'string' ? input.body_md : '',
			x: typeof input.x === 'number' ? input.x : 0,
			y: typeof input.y === 'number' ? input.y : 0,
			w: typeof input.w === 'number' ? input.w : null,
			h: typeof input.h === 'number' ? input.h : null,
			status,
			tags: Array.isArray(tags) ? tags.filter((t) => typeof t === 'string') : [],
			parent_id: typeof input.parent_id === 'string' ? input.parent_id : null,
			board_id: typeof input.board_id === 'string' ? input.board_id : 'default',
			ref: typeof input.ref === 'string' ? input.ref : undefined
		}
	};
}

export function createItem(input: CreateItemInput): Item {
	const db = getDb();
	if (input.parent_id && !getItem(input.parent_id)) {
		throw new StoreError(404, `parent item not found: ${input.parent_id}`);
	}
	if (input.board_id && !getBoard(input.board_id)) {
		throw new StoreError(404, `board not found: ${input.board_id}`);
	}
	const id = newId();
	insertWithRef(db, input.ref, 'items', (ref) =>
		db
			.prepare(
				`INSERT INTO items (id, kind, title, body_md, x, y, w, h, status, tags, parent_id, board_id, ref)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				id,
				input.kind ?? 'note',
				input.title,
				input.body_md ?? '',
				input.x ?? 0,
				input.y ?? 0,
				input.w ?? null,
				input.h ?? null,
				input.status ?? 'open',
				JSON.stringify(input.tags ?? []),
				input.parent_id ?? null,
				input.board_id ?? 'default',
				ref
			)
	);
	return getItem(id)!;
}

export function listItems(
	filter: { kind?: string; tag?: string; status?: string; parent_id?: string; board_id?: string } = {}
): Item[] {
	const db = getDb();
	const where: string[] = [];
	const params: (string | number)[] = [];
	if (filter.board_id) {
		where.push('board_id = ?');
		params.push(filter.board_id);
	}
	if (filter.kind) {
		where.push('kind = ?');
		params.push(filter.kind);
	}
	if (filter.status) {
		where.push('status = ?');
		params.push(filter.status);
	}
	if (filter.parent_id) {
		where.push('parent_id = ?');
		params.push(filter.parent_id);
	}
	if (filter.tag) {
		where.push('tags LIKE ?');
		params.push(`%"${filter.tag}"%`);
	}
	const sql = `SELECT * FROM items ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at`;
	const rows = db.prepare(sql).all(...params);
	return rows.map((r) => rowToItem(r as Record<string, unknown>));
}

export function getItem(idOrRef: string): Item | null {
	const db = getDb();
	let row = db.prepare('SELECT * FROM items WHERE id = ?').get(idOrRef);
	if (!row) row = db.prepare('SELECT * FROM items WHERE ref = ?').get(idOrRef);
	return row ? rowToItem(row as Record<string, unknown>) : null;
}

export function updateItem(id: string, patch: Record<string, unknown>): Item | null {
	const db = getDb();
	const existing = getItem(id);
	if (!existing) return null;

	const fields: Record<string, string | number | null> = {};
	if (typeof patch.kind === 'string') {
		if (!ITEM_KINDS.includes(patch.kind as ItemKind)) {
			throw new StoreError(400, `invalid kind: ${patch.kind} (must be one of: ${ITEM_KINDS.join(', ')})`);
		}
		fields.kind = patch.kind;
	}
	if (typeof patch.title === 'string') fields.title = patch.title;
	if (typeof patch.body_md === 'string') fields.body_md = patch.body_md;
	if (typeof patch.x === 'number') fields.x = patch.x;
	if (typeof patch.y === 'number') fields.y = patch.y;
	if (patch.w === null || typeof patch.w === 'number') fields.w = patch.w;
	if (patch.h === null || typeof patch.h === 'number') fields.h = patch.h;
	if (typeof patch.status === 'string') {
		if (!ITEM_STATUSES.includes(patch.status as ItemStatus)) {
			throw new StoreError(400, `invalid status: ${patch.status} (must be one of: ${ITEM_STATUSES.join(', ')})`);
		}
		fields.status = patch.status;
	}
	if (Array.isArray(patch.tags)) {
		fields.tags = JSON.stringify(patch.tags.filter((t) => typeof t === 'string'));
	}
	if (patch.parent_id === null || typeof patch.parent_id === 'string') {
		if (typeof patch.parent_id === 'string' && !getItem(patch.parent_id)) {
			throw new StoreError(404, `parent item not found: ${patch.parent_id}`);
		}
		fields.parent_id = patch.parent_id;
	}
	if (typeof patch.ref === 'string') {
		if (refTakenIn(db, 'items', patch.ref)) throw new StoreError(409, `ref already in use: ${patch.ref}`);
		fields.ref = patch.ref;
	}
	if (typeof patch.pct === 'number') {
		const pct = Math.max(0, Math.min(100, Math.round(patch.pct)));
		fields.pct = pct;
		if (pct >= 100) fields.status = 'done';
	} else if (patch.pct === null) {
		fields.pct = null;
	}

	if (Object.keys(fields).length === 0) return existing;

	const sets = Object.keys(fields).map((k) => `${k} = ?`);
	const values = Object.values(fields);
	db.prepare(`UPDATE items SET ${sets.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(...values, id);
	return getItem(id);
}

/**
 * Move an item to another board. Unknown target board throws StoreError 404;
 * unknown item returns null. Edges follow the moved item when the other
 * endpoint is already on the target board (intra-board edges stay intra-board);
 * edges whose other endpoint lives on a different board keep their original
 * board_id — they become effectively cross-board and are shown on neither
 * board's canvas.
 */
export function moveItem(id: string, board_id: string): Item | null {
	const db = getDb();
	if (!getBoard(board_id)) throw new StoreError(404, `board not found: ${board_id}`);
	const item = getItem(id);
	if (!item) return null;

	db.prepare(`UPDATE items SET board_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(
		board_id,
		id
	);
	db.prepare(
		`UPDATE edges SET board_id = ?
		 WHERE (from_id = ? AND to_id IN (SELECT id FROM items WHERE board_id = ?))
		    OR (to_id = ? AND from_id IN (SELECT id FROM items WHERE board_id = ?))`
	).run(board_id, id, board_id, id, board_id);

	return getItem(id);
}

/**
 * Duplicate an item. Copies kind, status, tags, and body_md; new id; x/y
 * offset by 30 so the clone does not sit on the original. `board_id`
 * defaults to the source board (unknown board throws StoreError 404);
 * `title_suffix` is appended to the title when given. Returns the new item,
 * or null for an unknown source.
 */
export function duplicateItem(
	id: string,
	opts: { board_id?: string; title_suffix?: string } = {}
): Item | null {
	const db = getDb();
	const source = getItem(id);
	if (!source) return null;
	const board_id = opts.board_id ?? source.board_id;
	if (!getBoard(board_id)) throw new StoreError(404, `board not found: ${board_id}`);
	const copyId = newId();
	insertWithRef(db, undefined, 'items', (ref) =>
		db
			.prepare(
				`INSERT INTO items (id, kind, title, body_md, x, y, w, h, status, tags, parent_id, board_id, ref)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				copyId,
				source.kind,
				opts.title_suffix ? `${source.title}${opts.title_suffix}` : source.title,
				source.body_md,
				source.x + 30,
				source.y + 30,
				source.w,
				source.h,
				source.status,
				JSON.stringify(source.tags),
				source.parent_id,
				board_id,
				ref
			)
	);
	return getItem(copyId);
}

/**
 * Delete an item and everything lifecycle-tied to it, in one transaction:
 * threads (messages follow via their FK ON DELETE CASCADE), decisions, and
 * agent tasks are removed; edges follow via their FK ON DELETE CASCADE.
 * Concepts intentionally survive with item_id = NULL (FK ON DELETE SET NULL)
 * — a concept card can outlive the note it was extracted from.
 */
export function deleteItem(id: string): boolean {
	const db = getDb();
	db.exec('BEGIN');
	try {
		db.prepare('DELETE FROM threads WHERE item_id = ?').run(id);
		db.prepare('DELETE FROM decisions WHERE item_id = ?').run(id);
		db.prepare('DELETE FROM agent_tasks WHERE item_id = ?').run(id);
		const res = db.prepare('DELETE FROM items WHERE id = ?').run(id);
		db.exec('COMMIT');
		return res.changes > 0;
	} catch (err) {
		db.exec('ROLLBACK');
		throw err;
	}
}

export interface CreateEdgeInput {
	from_id: string;
	to_id: string;
	kind?: string;
	label?: string;
	board_id?: string;
}

export function createEdge(input: CreateEdgeInput): Edge {
	const db = getDb();
	if (!getItem(input.from_id)) throw new StoreError(404, `from item not found: ${input.from_id}`);
	if (!getItem(input.to_id)) throw new StoreError(404, `to item not found: ${input.to_id}`);
	const id = newId();
	db.prepare('INSERT INTO edges (id, from_id, to_id, kind, label, board_id) VALUES (?, ?, ?, ?, ?, ?)').run(
		id,
		input.from_id,
		input.to_id,
		input.kind ?? 'depends_on',
		input.label ?? '',
		input.board_id ?? 'default'
	);
	return db.prepare('SELECT * FROM edges WHERE id = ?').get(id) as unknown as Edge;
}

export function listEdges(board_id?: string): Edge[] {
	const db = getDb();
	if (board_id) {
		return db.prepare('SELECT * FROM edges WHERE board_id = ? ORDER BY created_at').all(
			board_id
		) as unknown as Edge[];
	}
	return db.prepare('SELECT * FROM edges ORDER BY created_at').all() as unknown as Edge[];
}

export function getEdge(id: string): Edge | null {
	const db = getDb();
	const row = db.prepare('SELECT * FROM edges WHERE id = ?').get(id);
	return row ? (row as unknown as Edge) : null;
}

/**
 * Patch an edge. `kind` must be a non-empty string when provided (400);
 * `from_id`/`to_id` must reference existing items when provided (404).
 * A patch that collides with the unique (from_id, to_id, kind) index throws
 * the raw SQLite UNIQUE constraint error, which the API layer maps to 409.
 */
export function updateEdge(id: string, patch: Record<string, unknown>): Edge | null {
	const db = getDb();
	const existing = getEdge(id);
	if (!existing) return null;

	const fields: Record<string, string> = {};
	if (patch.kind !== undefined) {
		if (typeof patch.kind !== 'string' || patch.kind.trim() === '') {
			throw new StoreError(400, 'invalid kind: must be a non-empty string');
		}
		fields.kind = patch.kind;
	}
	if (patch.label !== undefined) {
		if (typeof patch.label !== 'string') {
			throw new StoreError(400, 'label must be a string');
		}
		fields.label = patch.label;
	}
	if (patch.from_id !== undefined) {
		if (typeof patch.from_id !== 'string' || !getItem(patch.from_id)) {
			throw new StoreError(404, `from item not found: ${patch.from_id}`);
		}
		fields.from_id = patch.from_id;
	}
	if (patch.to_id !== undefined) {
		if (typeof patch.to_id !== 'string' || !getItem(patch.to_id)) {
			throw new StoreError(404, `to item not found: ${patch.to_id}`);
		}
		fields.to_id = patch.to_id;
	}

	if (Object.keys(fields).length === 0) return existing;
	const sets = Object.keys(fields).map((k) => `${k} = ?`);
	db.prepare(`UPDATE edges SET ${sets.join(', ')} WHERE id = ?`).run(...Object.values(fields), id);
	return getEdge(id);
}

export function deleteEdge(id: string): boolean {
	const db = getDb();
	const res = db.prepare('DELETE FROM edges WHERE id = ?').run(id);
	return res.changes > 0;
}

// ---------- threads & messages ----------

export function createThread(title: string, item_id: string | null = null): Thread {
	const db = getDb();
	if (item_id && !getItem(item_id)) throw new StoreError(404, `item not found: ${item_id}`);
	const id = newId();
	db.prepare('INSERT INTO threads (id, title, item_id) VALUES (?, ?, ?)').run(id, title, item_id);
	return db.prepare('SELECT * FROM threads WHERE id = ?').get(id) as unknown as Thread;
}

export function listThreads(item_id?: string): Thread[] {
	const db = getDb();
	if (item_id) {
		return db.prepare('SELECT * FROM threads WHERE item_id = ? ORDER BY created_at DESC').all(item_id) as unknown as Thread[];
	}
	return db.prepare('SELECT * FROM threads ORDER BY created_at DESC').all() as unknown as Thread[];
}

export function getThread(id: string): Thread | null {
	const db = getDb();
	const row = db.prepare('SELECT * FROM threads WHERE id = ?').get(id);
	return row ? (row as unknown as Thread) : null;
}

export function getThreadForItem(item_id: string): Thread | null {
	const db = getDb();
	const row = db.prepare('SELECT * FROM threads WHERE item_id = ? ORDER BY created_at DESC LIMIT 1').get(item_id);
	return row ? (row as unknown as Thread) : null;
}

export function deleteThread(id: string): boolean {
	const db = getDb();
	const res = db.prepare('DELETE FROM threads WHERE id = ?').run(id);
	return res.changes > 0;
}

export interface CreateMessageInput {
	thread_id: string;
	role?: MessageRole;
	content: string;
	meta?: string | null;
}

export function createMessage(input: CreateMessageInput): Message {
	const db = getDb();
	const id = newId();
	db.prepare('INSERT INTO messages (id, thread_id, role, content, meta) VALUES (?, ?, ?, ?, ?)').run(
		id,
		input.thread_id,
		input.role ?? 'user',
		input.content,
		input.meta ?? null
	);
	return db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as unknown as Message;
}

/**
 * List a thread's messages, oldest first, with cursor pagination.
 * The cursor is rowid-based (monotonic insert order) rather than
 * created_at-based, so messages created in the same millisecond cannot be
 * skipped, duplicated, or reordered across pages. An unknown `before_id`
 * yields an empty list.
 */
export function listMessages(thread_id: string, limit = 200, before_id?: string): Message[] {
	const db = getDb();
	let rows: unknown[];
	if (before_id) {
		const anchor = db
			.prepare('SELECT rowid FROM messages WHERE thread_id = ? AND id = ?')
			.get(thread_id, before_id) as { rowid: number } | undefined;
		if (!anchor) return [];
		rows = db
			.prepare('SELECT * FROM messages WHERE thread_id = ? AND rowid < ? ORDER BY rowid DESC LIMIT ?')
			.all(thread_id, anchor.rowid, limit) as unknown[];
	} else {
		rows = db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY rowid DESC LIMIT ?').all(
			thread_id,
			limit
		) as unknown[];
	}
	return (rows as unknown as Message[]).reverse();
}

export function deleteMessage(thread_id: string, message_id: string): boolean {
	const db = getDb();
	const res = db.prepare('DELETE FROM messages WHERE thread_id = ? AND id = ?').run(
		thread_id,
		message_id
	);
	return res.changes > 0;
}

// ---------- decisions ----------

export interface CreateDecisionInput {
	item_id?: string | null;
	question: string;
	options?: string[];
	choice?: string | null;
	rationale?: string;
	ref?: string;
}

export function createDecision(input: CreateDecisionInput): Decision {
	const db = getDb();
	if (input.item_id && !getItem(input.item_id)) {
		throw new StoreError(404, `item not found: ${input.item_id}`);
	}
	const id = newId();
	insertWithRef(db, input.ref, 'decisions', (ref) =>
		db
			.prepare(
				`INSERT INTO decisions (id, item_id, question, options, choice, rationale, ref)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				id,
				input.item_id ?? null,
				input.question,
				JSON.stringify(input.options ?? []),
				input.choice ?? null,
				input.rationale ?? '',
				ref
			)
	);
	const row = db.prepare('SELECT * FROM decisions WHERE id = ?').get(id);
	return rowToDecision(row as Record<string, unknown>);
}

function rowToDecision(row: Record<string, unknown>): Decision {
	let options: string[] = [];
	try {
		const parsed = JSON.parse(row.options as string);
		options = Array.isArray(parsed) ? (parsed as string[]) : [];
	} catch {
		// leave options as empty array
	}
	return {
		id: row.id as string,
		item_id: (row.item_id as string | null) ?? null,
		question: row.question as string,
		options,
		choice: (row.choice as string | null) ?? null,
		rationale: row.rationale as string,
		status: row.status as DecisionStatus,
		ref: (row.ref as string | null) ?? null,
		created_at: row.created_at as string,
		updated_at: row.updated_at as string
	};
}

export function listDecisions(filter: { item_id?: string; status?: string; ref?: string } = {}): Decision[] {
	const db = getDb();
	const where: string[] = [];
	const params: (string | number)[] = [];
	if (filter.item_id) {
		where.push('item_id = ?');
		params.push(filter.item_id);
	}
	if (filter.status) {
		where.push('status = ?');
		params.push(filter.status);
	}
	if (filter.ref) {
		where.push('ref = ?');
		params.push(filter.ref);
	}
	const sql = `SELECT * FROM decisions ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC`;
	return db.prepare(sql).all(...params).map((r) => rowToDecision(r as Record<string, unknown>));
}

export function listDecisionsForBoard(board_id: string): Decision[] {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT d.* FROM decisions d
			 JOIN items i ON i.id = d.item_id
			 WHERE i.board_id = ?
			 ORDER BY d.created_at`
		)
		.all(board_id) as unknown[];
	return rows.map((r) => rowToDecision(r as Record<string, unknown>));
}

export function getDecision(idOrRef: string): Decision | null {
	const db = getDb();
	let row = db.prepare('SELECT * FROM decisions WHERE id = ?').get(idOrRef);
	if (!row) row = db.prepare('SELECT * FROM decisions WHERE ref = ?').get(idOrRef);
	return row ? rowToDecision(row as Record<string, unknown>) : null;
}

export function updateDecision(id: string, patch: Record<string, unknown>): Decision | null {
	const db = getDb();
	if (!getDecision(id)) return null;
	const fields: Record<string, string | number | null> = {};
	if (typeof patch.question === 'string') fields.question = patch.question;
	if (Array.isArray(patch.options)) fields.options = JSON.stringify(patch.options);
	if (patch.choice === null || typeof patch.choice === 'string') fields.choice = patch.choice;
	if (typeof patch.rationale === 'string') fields.rationale = patch.rationale;
	if (typeof patch.status === 'string') {
		if (!DECISION_STATUSES.includes(patch.status as DecisionStatus)) {
			throw new StoreError(
				400,
				`invalid status: ${patch.status} (must be one of: ${DECISION_STATUSES.join(', ')})`
			);
		}
		fields.status = patch.status;
	}
	if (typeof patch.ref === 'string') {
		if (refTakenIn(db, 'decisions', patch.ref)) throw new StoreError(409, `ref already in use: ${patch.ref}`);
		fields.ref = patch.ref;
	}
	if (Object.keys(fields).length === 0) return getDecision(id);
	const sets = Object.keys(fields).map((k) => `${k} = ?`);
	db.prepare(`UPDATE decisions SET ${sets.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(
		...Object.values(fields),
		id
	);
	return getDecision(id);
}

export function deleteDecision(id: string): boolean {
	const db = getDb();
	const res = db.prepare('DELETE FROM decisions WHERE id = ?').run(id);
	return res.changes > 0;
}

export interface ResolvedRef {
	source: 'item' | 'decision' | 'concept';
	id: string;
	ref: string;
	title: string;
	status: string | null;
	board_id: string | null;
}

export function resolveRef(ref: string): ResolvedRef | null {
	const db = getDb();
	const itemRow = db.prepare('SELECT * FROM items WHERE ref = ?').get(ref);
	if (itemRow) {
		const item = rowToItem(itemRow as Record<string, unknown>);
		return {
			source: 'item',
			id: item.id,
			ref: item.ref ?? ref,
			title: item.title,
			status: item.status,
			board_id: item.board_id
		};
	}
	const decisionRow = db.prepare('SELECT * FROM decisions WHERE ref = ?').get(ref);
	if (decisionRow) {
		const decision = rowToDecision(decisionRow as Record<string, unknown>);
		const attached = decision.item_id ? getItem(decision.item_id) : null;
		return {
			source: 'decision',
			id: decision.id,
			ref: decision.ref ?? ref,
			title: decision.question,
			status: decision.status,
			board_id: attached ? attached.board_id : null
		};
	}
	const conceptRow = db.prepare('SELECT * FROM concepts WHERE ref = ?').get(ref);
	if (conceptRow) {
		const concept = rowToConcept(conceptRow as Record<string, unknown>);
		const attached = concept.item_id ? getItem(concept.item_id) : null;
		return {
			source: 'concept',
			id: concept.id,
			ref: concept.ref ?? ref,
			title: concept.name,
			status: null,
			board_id: attached ? attached.board_id : null
		};
	}
	return null;
}

export interface RecordDecisionInput {
	question: string;
	options?: string[];
	why?: string;
	rec?: string;
	ref?: string;
	board_id?: string;
}

export function recordDecision(input: RecordDecisionInput): { ref: string; item: Item; decision: Decision } {
	const db = getDb();
	const board_id = input.board_id ?? 'default';
	if (!getBoard(board_id)) throw new StoreError(404, `board not found: ${board_id}`);
	let ref: string;
	if (input.ref === undefined) {
		ref = newUniqueRef(db);
	} else if (refTaken(db, input.ref)) {
		throw new StoreError(409, `ref already in use: ${input.ref}`);
	} else {
		ref = input.ref;
	}
	const bodyParts: string[] = [];
	if (input.why) bodyParts.push(`Why: ${input.why}`);
	if (input.rec) bodyParts.push(`Rec: ${input.rec}`);
	db.exec('BEGIN');
	try {
		const item = createItem({
			kind: 'decision',
			title: input.question,
			body_md: bodyParts.join('\n\n'),
			board_id,
			ref
		});
		const decision = createDecision({
			item_id: item.id,
			question: input.question,
			options: input.options ?? [],
			choice: null,
			rationale: input.why ?? '',
			ref
		});
		const thread = createThread(`Discussion: ${input.question}`, item.id);
		createMessage({ thread_id: thread.id, role: 'system', content: input.question });
		db.exec('COMMIT');
		return { ref, item, decision };
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	}
}

export interface RecordTaskInput {
	what: string;
	body_md?: string;
	ref?: string;
	board_id?: string;
}

/**
 * Record a unit of background work as a task item, canonical-titled `[tt] <what>`,
 * under one short ref with a seeded thread — addressable from chat, board, and agents.
 */
export function recordTask(input: RecordTaskInput): { ref: string; item: Item } {
	const db = getDb();
	const board_id = input.board_id ?? 'default';
	if (!getBoard(board_id)) throw new StoreError(404, `board not found: ${board_id}`);
	let ref: string;
	if (input.ref === undefined) {
		ref = newUniqueRef(db);
	} else if (refTaken(db, input.ref)) {
		throw new StoreError(409, `ref already in use: ${input.ref}`);
	} else {
		ref = input.ref;
	}
	db.exec('BEGIN');
	try {
		const item = createItem({
			kind: 'task',
			title: `[tt] ${input.what}`,
			body_md: input.body_md ?? '',
			status: 'open',
			board_id,
			ref
		});
		const thread = createThread(`Work: ${input.what}`, item.id);
		createMessage({ thread_id: thread.id, role: 'system', content: input.what });
		db.exec('COMMIT');
		return { ref, item };
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	}
}

function normalizeAnswer(options: string[], answer: string): string {
	const trimmed = answer.trim();
	const exact = options.find((o) => o.toLowerCase() === trimmed.toLowerCase());
	if (exact) return exact;
	const match = /^(?:option\s+)?(\d+)$/i.exec(trimmed);
	if (match) {
		const index = Number(match[1]) - 1;
		if (index >= 0 && index < options.length) return options[index];
	}
	if (options.length === 0) return trimmed;
	throw new StoreError(400, `answer must be one of: ${options.join(', ')}`);
}

export function unblock(itemId: string): Item | null {
	const db = getDb();
	const item = getItem(itemId);
	if (!item) return null;
	if (item.status !== 'blocked') return item;
	db.prepare(`UPDATE items SET status = 'open', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(
		itemId
	);
	return getItem(itemId);
}

export function resolveDecision(
	ref: string,
	answer: string,
	rationale?: string
): { decision: Decision; item: Item; unblocked: Item[] } {
	const db = getDb();
	let decision = getDecision(ref);
	let item: Item | null = decision?.item_id ? getItem(decision.item_id) : null;
	if (!decision || !item) {
		const candidate = resolveRef(ref);
		if (candidate?.source !== 'item') throw new StoreError(404, `no decision with ref ${ref}`);
		item = getItem(candidate.id);
		decision = listDecisions({ item_id: candidate.id }).find((d) => d.status === 'active') ?? null;
	}
	if (!decision || !item) throw new StoreError(404, `no decision with ref ${ref}`);

	const choice = normalizeAnswer(decision.options, answer);
	if (decision.choice === choice) {
		return { decision, item, unblocked: [] };
	}

	db.exec('BEGIN');
	try {
		db
			.prepare(`UPDATE decisions SET choice = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
			.run(choice, decision.id);
		const thread = getThreadForItem(item.id) ?? createThread(`Discussion: ${item.title}`, item.id);
		let content = `Resolved: ${decision.question} → ${choice}`;
		if (rationale) content += `\n${rationale}`;
		createMessage({
			thread_id: thread.id,
			role: 'system',
			content,
			meta: JSON.stringify({ ref, decision_id: decision.id })
		});
		db
			.prepare(`UPDATE items SET status = 'done', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
			.run(item.id);
		const unblocked: Item[] = [];
		const edges = db
			.prepare(`SELECT from_id FROM edges WHERE kind = 'blocks' AND to_id = ?`)
			.all(item.id) as { from_id: string }[];
		for (const edge of edges) {
			if (getItem(edge.from_id)?.status === 'blocked') {
				const freed = unblock(edge.from_id);
				if (freed) unblocked.push(freed);
			}
		}
		db.exec('COMMIT');
		const finalDecision = getDecision(decision.id);
		const finalItem = getItem(item.id);
		if (!finalDecision || !finalItem) throw new Error('decision or item disappeared during resolve');
		return { decision: finalDecision, item: finalItem, unblocked };
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	}
}

// ---------- concepts ----------

export interface CreateConceptInput {
	name: string;
	definition?: string;
	details_md?: string;
	source?: string | null;
	item_id?: string | null;
	ref?: string;
}

function rowToConcept(row: Record<string, unknown>): Concept {
	return {
		id: row.id as string,
		name: row.name as string,
		definition: row.definition as string,
		details_md: row.details_md as string,
		source: (row.source as string | null) ?? null,
		item_id: (row.item_id as string | null) ?? null,
		ref: (row.ref as string | null) ?? null,
		created_at: row.created_at as string,
		updated_at: row.updated_at as string
	};
}

export function createConcept(input: CreateConceptInput): Concept {
	const db = getDb();
	if (input.item_id && !getItem(input.item_id)) {
		throw new StoreError(404, `item not found: ${input.item_id}`);
	}
	const id = newId();
	insertWithRef(db, input.ref, 'concepts', (ref) =>
		db
			.prepare(
				`INSERT INTO concepts (id, name, definition, details_md, source, item_id, ref)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				id,
				input.name,
				input.definition ?? '',
				input.details_md ?? '',
				input.source ?? null,
				input.item_id ?? null,
				ref
			)
	);
	return getConcept(id)!;
}

export function listConcepts(): Concept[] {
	const db = getDb();
	return db
		.prepare('SELECT * FROM concepts ORDER BY name')
		.all()
		.map((r) => rowToConcept(r as Record<string, unknown>));
}

export function getConcept(idOrRef: string): Concept | null {
	const db = getDb();
	let row = db.prepare('SELECT * FROM concepts WHERE id = ?').get(idOrRef);
	if (!row) row = db.prepare('SELECT * FROM concepts WHERE ref = ?').get(idOrRef);
	return row ? rowToConcept(row as Record<string, unknown>) : null;
}

export function getConceptForItem(item_id: string): Concept | null {
	const db = getDb();
	const row = db.prepare('SELECT * FROM concepts WHERE item_id = ? LIMIT 1').get(item_id);
	return row ? rowToConcept(row as Record<string, unknown>) : null;
}

export function updateConcept(id: string, patch: Record<string, unknown>): Concept | null {
	const db = getDb();
	if (!getConcept(id)) return null;
	const fields: Record<string, string | number | null> = {};
	if (typeof patch.name === 'string') {
		if (listConcepts().some((c) => c.name === patch.name && c.id !== id)) {
			throw new StoreError(409, `concept name already exists: ${patch.name}`);
		}
		fields.name = patch.name;
	}
	if (typeof patch.definition === 'string') fields.definition = patch.definition;
	if (typeof patch.details_md === 'string') fields.details_md = patch.details_md;
	if (patch.source === null || typeof patch.source === 'string') fields.source = patch.source;
	if (typeof patch.ref === 'string') {
		if (refTakenIn(db, 'concepts', patch.ref)) throw new StoreError(409, `ref already in use: ${patch.ref}`);
		fields.ref = patch.ref;
	}
	if (Object.keys(fields).length === 0) return getConcept(id);
	const sets = Object.keys(fields).map((k) => `${k} = ?`);
	db.prepare(`UPDATE concepts SET ${sets.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(
		...Object.values(fields),
		id
	);
	return getConcept(id);
}

export function getConceptByName(name: string): Concept | null {
	const key = name.trim().toLowerCase();
	if (!key) return null;
	for (const c of listConcepts()) {
		if (c.name.trim().toLowerCase() === key) return c;
	}
	return null;
}

export interface UpsertConceptInput {
	definition?: string;
	details_md?: string;
	source?: string | null;
	item_id?: string | null;
	ref?: string;
}

export function upsertConceptByName(name: string, input: UpsertConceptInput = {}): Concept {
	const trimmed = name.trim();
	if (!trimmed) throw new StoreError(400, 'name is required');
	const existing = getConceptByName(trimmed);
	if (existing) {
		const patch: Record<string, unknown> = {};
		if (input.definition !== undefined) patch.definition = input.definition;
		if (input.details_md !== undefined) patch.details_md = input.details_md;
		if (input.source !== undefined) patch.source = input.source;
		if (Object.keys(patch).length === 0) return existing;
		return updateConcept(existing.id, patch) ?? existing;
	}
	return createConcept({
		name: trimmed,
		definition: input.definition,
		details_md: input.details_md,
		source: input.source ?? null,
		item_id: input.item_id ?? null,
		ref: input.ref
	});
}

export function deleteConcept(id: string): boolean {
	const db = getDb();
	const res = db.prepare('DELETE FROM concepts WHERE id = ?').run(id);
	return res.changes > 0;
}

// ---------- agent tasks ----------

export function createAgentTask(input: {
	item_id?: string | null;
	prompt: string;
	agent?: string | null;
	model?: string | null;
}): AgentTask {
	const db = getDb();
	const id = newId();
	db.prepare(
		`INSERT INTO agent_tasks (id, item_id, prompt, agent, model, status, started_at)
		 VALUES (?, ?, ?, ?, ?, 'running', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
	).run(id, input.item_id ?? null, input.prompt, input.agent ?? null, input.model ?? null);
	return db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(id) as unknown as AgentTask;
}

export function listAgentTasks(limit = 50, filter: { item_id?: string; status?: string } = {}): AgentTask[] {
	const db = getDb();
	const where: string[] = [];
	const params: (string | number)[] = [];
	if (filter.item_id) {
		where.push('item_id = ?');
		params.push(filter.item_id);
	}
	if (filter.status) {
		where.push('status = ?');
		params.push(filter.status);
	}
	params.push(limit);
	const sql = `SELECT * FROM agent_tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`;
	return db.prepare(sql).all(...params) as unknown as AgentTask[];
}

export function getAgentTask(id: string): AgentTask | null {
	const db = getDb();
	const row = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(id);
	return row ? (row as unknown as AgentTask) : null;
}

export function getRunningAgentTaskForItem(item_id: string): AgentTask | null {
	const db = getDb();
	const row = db
		.prepare("SELECT * FROM agent_tasks WHERE item_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1")
		.get(item_id);
	return row ? (row as unknown as AgentTask) : null;
}

export function finishAgentTask(id: string, status: AgentTaskStatus, transcript?: string | null): void {
	const db = getDb();
	db.prepare(
		`UPDATE agent_tasks SET status = ?, transcript = COALESCE(?, transcript), finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
	).run(status, transcript ?? null, id);
}

/**
 * Mark every 'running' agent task as failed. Called at runner module load
 * (== server startup): the in-memory process table is always empty then, so
 * any 'running' row is an orphan from a previous process — left alone it would
 * wedge the item behind the per-item 409 guard forever.
 * Returns the number of rows reconciled.
 */
export function reconcileStaleAgentTasks(): number {
	const db = getDb();
	const res = db
		.prepare(
			`UPDATE agent_tasks
			 SET status = 'failed',
			     transcript = COALESCE(transcript, '') || ?,
			     finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
			 WHERE status = 'running'
		`)
		.run('\n\n[server restarted; task was interrupted]');
	return Number(res.changes);
}

// ---------- boards ----------

export function listBoards(): BoardWithCount[] {
	const db = getDb();
	return db
		.prepare(
			`SELECT b.*, COUNT(i.id) AS item_count
			 FROM boards b
			 LEFT JOIN items i ON i.board_id = b.id
			 GROUP BY b.id
			 ORDER BY b.created_at`
		)
		.all() as unknown as BoardWithCount[];
}

export function getBoard(id: string): Board | null {
	const db = getDb();
	const row = db.prepare('SELECT * FROM boards WHERE id = ?').get(id);
	return row ? (row as unknown as Board) : null;
}

export function createBoard(name: string): Board {
	const db = getDb();
	if (listBoards().some((b) => b.name === name)) {
		throw new StoreError(409, `board name already exists: ${name}`);
	}
	const id = `b_${newId().slice(0, 8)}`;
	db.prepare('INSERT INTO boards (id, name) VALUES (?, ?)').run(id, name);
	return getBoard(id)!;
}

export function renameBoard(id: string, name: string): Board | null {
	const db = getDb();
	if (!getBoard(id)) return null;
	if (listBoards().some((b) => b.id !== id && b.name === name)) {
		throw new StoreError(409, `board name already exists: ${name}`);
	}
	db.prepare('UPDATE boards SET name = ? WHERE id = ?').run(name, id);
	return getBoard(id);
}

export function deleteBoard(id: string): boolean {
	if (id === 'default') return false;
	const db = getDb();
	const items = (db.prepare('SELECT COUNT(*) AS n FROM items WHERE board_id = ?').get(id) as { n: number }).n;
	if (items > 0) return false;
	const res = db.prepare('DELETE FROM boards WHERE id = ?').run(id);
	return res.changes > 0;
}
