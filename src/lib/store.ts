import { getDb, newId, ITEM_KINDS, ITEM_STATUSES } from './db.js';
import type { Item, Edge, ItemKind, ItemStatus } from './db.js';

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
