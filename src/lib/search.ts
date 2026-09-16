import { getDb } from './db.js';
import type { SearchHit } from './types.js';

export type { SearchHit };

/**
 * Full-text search across items, decisions, concepts, and messages via FTS5.
 * Returns hits ranked by bm25 (lower is better), normalised into a positive score.
 * Every hit carries `item_id`/`board_id` so the UI can navigate to the parent item:
 * item hits are themselves; decisions/concepts join through their item; messages
 * join through thread.item_id → items.
 * When `board_id` is given, hits are restricted to that board.
 */
export function search(
	query: string,
	opts: { limit?: number; source?: SearchHit['source']; board_id?: string } = {}
): SearchHit[] {
	const db = getDb();
	const q = query.trim();
	if (!q) return [];
	const limit = opts.limit ?? 20;

	// Quote the query so user input is treated as literal text, then OR the tokens.
	const safe = q.replace(/["']/g, '');
	const ftsQuery = safe
		.split(/\s+/)
		.filter(Boolean)
		.map((t) => `"${t.replace(/"/g, '""')}"`)
		.join(' OR ');

	const tables: {
		source: SearchHit['source'];
		table: string;
		titleExpr: string;
		snipExpr: string;
		extraCols: string;
		extraJoins: string;
		boardClause: string;
	}[] = [
		{
			source: 'item',
			table: 'fts_items',
			titleExpr: 'i.title',
			snipExpr: 'i.body_md',
			extraCols: 'i.id AS item_id, i.board_id AS board_id',
			extraJoins: '',
			boardClause: 'AND i.board_id = ?'
		},
		{
			source: 'decision',
			table: 'fts_decisions',
			titleExpr: 'd.question',
			snipExpr: 'd.rationale',
			extraCols: 'd.item_id AS item_id, ib.board_id AS board_id',
			extraJoins: 'LEFT JOIN items ib ON ib.id = d.item_id',
			boardClause: 'AND d.item_id IN (SELECT id FROM items WHERE board_id = ?)'
		},
		{
			source: 'concept',
			table: 'fts_concepts',
			titleExpr: 'c.name',
			snipExpr: 'c.definition',
			extraCols: 'c.item_id AS item_id, ib.board_id AS board_id',
			extraJoins: 'LEFT JOIN items ib ON ib.id = c.item_id',
			boardClause: 'AND c.item_id IN (SELECT id FROM items WHERE board_id = ?)'
		},
		{
			source: 'message',
			table: 'fts_messages',
			titleExpr: 'm.content',
			snipExpr: 'm.content',
			extraCols: 'th.item_id AS item_id, ib.board_id AS board_id',
			extraJoins: 'JOIN threads th ON th.id = m.thread_id LEFT JOIN items ib ON ib.id = th.item_id',
			boardClause: 'AND m.thread_id IN (SELECT id FROM threads WHERE item_id IN (SELECT id FROM items WHERE board_id = ?))'
		}
	];

	const hits: SearchHit[] = [];
	for (const t of tables) {
		if (opts.source && opts.source !== t.source) continue;
		const join =
			t.source === 'item'
				? 'JOIN items i ON i.rowid = fts_items.rowid'
				: t.source === 'decision'
					? 'JOIN decisions d ON d.rowid = fts_decisions.rowid'
					: t.source === 'concept'
						? 'JOIN concepts c ON c.rowid = fts_concepts.rowid'
						: 'JOIN messages m ON m.rowid = fts_messages.rowid';
		const boardClause = opts.board_id ? t.boardClause : '';
		const params = opts.board_id ? [ftsQuery, opts.board_id, limit] : [ftsQuery, limit];
		try {
			const rows = db
				.prepare(
					`SELECT COALESCE(${
						t.source === 'item' ? 'i.id' : t.source === 'decision' ? 'd.id' : t.source === 'concept' ? 'c.id' : 'm.id'
					}, '') AS id,
						COALESCE(${t.titleExpr}, '') AS title,
						snippet(${t.table}, -1, '«', '»', ' … ', 40) AS snippet,
						bm25(${t.table}) AS score,
						${t.extraCols}
					FROM ${t.table}
					${join}
					${t.extraJoins}
					WHERE ${t.table} MATCH ?
					${boardClause}
					ORDER BY score
					LIMIT ?`
				)
				.all(
					...params
				) as {
					id: string;
					title: string;
					snippet: string;
					score: number;
					item_id: string | null;
					board_id: string | null;
				}[];
			for (const r of rows) {
				hits.push({
					source: t.source,
					id: r.id,
					title: r.title,
					snippet: r.snippet,
					score: -r.score,
					item_id: r.item_id ?? null,
					board_id: r.board_id ?? null
				});
			}
		} catch {
			// ignore per-table query errors (e.g. a table with no data)
		}
	}

	hits.sort((a, b) => b.score - a.score);
	return hits.slice(0, limit);
}
