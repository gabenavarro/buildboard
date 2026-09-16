import { getDb } from './db.js';

export interface SearchHit {
	source: 'item' | 'decision' | 'concept' | 'message';
	id: string;
	title: string;
	snippet: string;
	score: number;
}

/**
 * Full-text search across items, decisions, concepts, and messages via FTS5.
 * Returns hits ranked by bm25 (lower is better), normalised into a positive score.
 */
export function search(query: string, opts: { limit?: number; source?: SearchHit['source'] } = {}): SearchHit[] {
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

	const tables: { source: SearchHit['source']; table: string; titleExpr: string; snipExpr: string }[] = [
		{ source: 'item', table: 'fts_items', titleExpr: 'i.title', snipExpr: 'i.body_md' },
		{ source: 'decision', table: 'fts_decisions', titleExpr: 'd.question', snipExpr: 'd.rationale' },
		{ source: 'concept', table: 'fts_concepts', titleExpr: 'c.name', snipExpr: 'c.definition' },
		{ source: 'message', table: 'fts_messages', titleExpr: 'm.content', snipExpr: 'm.content' }
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
		const titleCol = t.source === 'item' ? 'i.id' : t.source === 'decision' ? 'd.id' : t.source === 'concept' ? 'c.id' : 'm.id';
		try {
			const rows = db
				.prepare(
					`SELECT ${titleCol} AS id,
						COALESCE(${t.titleExpr}, '') AS title,
						snippet(${t.table}, -1, '«', '»', ' … ', 40) AS snippet,
						bm25(${t.table}) AS score
					FROM ${t.table}
					${join}
					WHERE ${t.table} MATCH ?
					ORDER BY score
					LIMIT ?`
				)
				.all(ftsQuery, limit) as { id: string; title: string; snippet: string; score: number }[];
			for (const r of rows) {
				hits.push({ source: t.source, id: r.id, title: r.title, snippet: r.snippet, score: -r.score });
			}
		} catch {
			// ignore per-table query errors (e.g. a table with no data)
		}
	}

	hits.sort((a, b) => b.score - a.score);
	return hits.slice(0, limit);
}
