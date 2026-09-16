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
	Concept
} from './db.js';

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
			parent_id: typeof input.parent_id === 'string' ? input.parent_id : null
		}
	};
}

export function createItem(input: CreateItemInput): Item {
	const db = getDb();
	const id = newId();
	db.prepare(
		`INSERT INTO items (id, kind, title, body_md, x, y, w, h, status, tags, parent_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
		input.parent_id ?? null
	);
	return getItem(id)!;
}

export function listItems(filter: { kind?: string; tag?: string; status?: string; parent_id?: string } = {}): Item[] {
	const db = getDb();
	const where: string[] = [];
	const params: (string | number)[] = [];
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
		if (!ITEM_KINDS.includes(patch.kind as ItemKind)) throw new Error(`invalid kind: ${patch.kind}`);
		fields.kind = patch.kind;
	}
	if (typeof patch.title === 'string') fields.title = patch.title;
	if (typeof patch.body_md === 'string') fields.body_md = patch.body_md;
	if (typeof patch.x === 'number') fields.x = patch.x;
	if (typeof patch.y === 'number') fields.y = patch.y;
	if (patch.w === null || typeof patch.w === 'number') fields.w = patch.w;
	if (patch.h === null || typeof patch.h === 'number') fields.h = patch.h;
	if (typeof patch.status === 'string') {
		if (!ITEM_STATUSES.includes(patch.status as ItemStatus)) throw new Error(`invalid status: ${patch.status}`);
		fields.status = patch.status;
	}
	if (Array.isArray(patch.tags)) {
		fields.tags = JSON.stringify(patch.tags.filter((t) => typeof t === 'string'));
	}
	if (patch.parent_id === null || typeof patch.parent_id === 'string') fields.parent_id = patch.parent_id;

	if (Object.keys(fields).length === 0) return existing;

	const sets = Object.keys(fields).map((k) => `${k} = ?`);
	const values = Object.values(fields);
	db.prepare(`UPDATE items SET ${sets.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(...values, id);
	return getItem(id);
}

export function deleteItem(id: string): boolean {
	const db = getDb();
	const res = db.prepare('DELETE FROM items WHERE id = ?').run(id);
	return res.changes > 0;
}

export interface CreateEdgeInput {
	from_id: string;
	to_id: string;
	kind?: string;
	label?: string;
}

export function createEdge(input: CreateEdgeInput): Edge {
	const db = getDb();
	const id = newId();
	db.prepare('INSERT INTO edges (id, from_id, to_id, kind, label) VALUES (?, ?, ?, ?, ?)').run(
		id,
		input.from_id,
		input.to_id,
		input.kind ?? 'depends_on',
		input.label ?? ''
	);
	return db.prepare('SELECT * FROM edges WHERE id = ?').get(id) as unknown as Edge;
}

export function listEdges(): Edge[] {
	const db = getDb();
	return db.prepare('SELECT * FROM edges ORDER BY created_at').all() as unknown as Edge[];
}

export function deleteEdge(id: string): boolean {
	const db = getDb();
	const res = db.prepare('DELETE FROM edges WHERE id = ?').run(id);
	return res.changes > 0;
}

// ---------- threads & messages ----------

export function createThread(title: string, item_id: string | null = null): Thread {
	const db = getDb();
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

export function listMessages(thread_id: string, limit = 200, before_id?: string): Message[] {
	const db = getDb();
	let rows: unknown[];
	if (before_id) {
		rows = db
			.prepare(
				`SELECT * FROM messages WHERE thread_id = ? AND created_at < (SELECT created_at FROM messages WHERE id = ?)
				 ORDER BY created_at DESC LIMIT ?`
			)
			.all(thread_id, before_id, limit) as unknown[];
	} else {
		rows = db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?').all(
			thread_id,
			limit
		) as unknown[];
	}
	return (rows as unknown as Message[]).reverse();
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
	if (typeof patch.status === 'string') fields.status = patch.status;
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
	if (typeof patch.name === 'string') fields.name = patch.name;
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
