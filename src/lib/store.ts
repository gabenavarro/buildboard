import { getDb, newId, ITEM_KINDS, ITEM_STATUSES } from './db.js';
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
	Board
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
			board_id: typeof input.board_id === 'string' ? input.board_id : 'default'
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
	db.prepare(
		`INSERT INTO items (id, kind, title, body_md, x, y, w, h, status, tags, parent_id, board_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
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
		input.board_id ?? 'default'
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

export function getItem(id: string): Item | null {
	const db = getDb();
	const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
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
	db.prepare(
		`INSERT INTO items (id, kind, title, body_md, x, y, w, h, status, tags, parent_id, board_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
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
		board_id
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
}

export function createDecision(input: CreateDecisionInput): Decision {
	const db = getDb();
	if (input.item_id && !getItem(input.item_id)) {
		throw new StoreError(404, `item not found: ${input.item_id}`);
	}
	const id = newId();
	db.prepare(
		`INSERT INTO decisions (id, item_id, question, options, choice, rationale) VALUES (?, ?, ?, ?, ?, ?)`
	).run(
		id,
		input.item_id ?? null,
		input.question,
		JSON.stringify(input.options ?? []),
		input.choice ?? null,
		input.rationale ?? ''
	);
	return db.prepare('SELECT * FROM decisions WHERE id = ?').get(id) as unknown as Decision;
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
		created_at: row.created_at as string,
		updated_at: row.updated_at as string
	};
}

export function listDecisions(filter: { item_id?: string; status?: string } = {}): Decision[] {
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
	const sql = `SELECT * FROM decisions ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC`;
	return db.prepare(sql).all(...params).map((r) => rowToDecision(r as Record<string, unknown>));
}

export function getDecision(id: string): Decision | null {
	const db = getDb();
	const row = db.prepare('SELECT * FROM decisions WHERE id = ?').get(id);
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

// ---------- concepts ----------

export interface CreateConceptInput {
	name: string;
	definition?: string;
	details_md?: string;
	source?: string | null;
	item_id?: string | null;
}

export function createConcept(input: CreateConceptInput): Concept {
	const db = getDb();
	if (input.item_id && !getItem(input.item_id)) {
		throw new StoreError(404, `item not found: ${input.item_id}`);
	}
	const id = newId();
	db.prepare(
		`INSERT INTO concepts (id, name, definition, details_md, source, item_id) VALUES (?, ?, ?, ?, ?, ?)`
	).run(
		id,
		input.name,
		input.definition ?? '',
		input.details_md ?? '',
		input.source ?? null,
		input.item_id ?? null
	);
	return db.prepare('SELECT * FROM concepts WHERE id = ?').get(id) as unknown as Concept;
}

export function listConcepts(): Concept[] {
	const db = getDb();
	return db.prepare('SELECT * FROM concepts ORDER BY name').all() as unknown as Concept[];
}

export function getConcept(id: string): Concept | null {
	const db = getDb();
	const row = db.prepare('SELECT * FROM concepts WHERE id = ?').get(id);
	return row ? (row as unknown as Concept) : null;
}

export function getConceptForItem(item_id: string): Concept | null {
	const db = getDb();
	const row = db.prepare('SELECT * FROM concepts WHERE item_id = ? LIMIT 1').get(item_id);
	return row ? (row as unknown as Concept) : null;
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
	if (Object.keys(fields).length === 0) return getConcept(id);
	const sets = Object.keys(fields).map((k) => `${k} = ?`);
	db.prepare(`UPDATE concepts SET ${sets.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(
		...Object.values(fields),
		id
	);
	return getConcept(id);
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

// ---------- boards ----------

export function listBoards(): Board[] {
	const db = getDb();
	return db.prepare('SELECT * FROM boards ORDER BY created_at').all() as unknown as Board[];
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
