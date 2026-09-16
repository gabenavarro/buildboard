import { getDb } from './db.js';

export interface BriefOptions {
	board_id?: string;
	token_budget?: number;
}

/**
 * Build a compact context digest (~200 tokens) of a board.
 * Designed to be handed to an agent so it can orient itself without
 * pulling the full database. `board_id` defaults to 'default'; decisions,
 * threads, concepts, and agent tasks carry no board of their own, so they
 * are scoped through their item (orphaned rows are dropped). `token_budget`
 * scales each section's LIMIT relative to the default 200-token brief.
 * Returns plain text/markdown.
 */
export function buildBrief(opts: BriefOptions = {}): string {
	const db = getDb();
	const board_id = opts.board_id ?? 'default';

	const budget = opts.token_budget ?? 200;
	const scale = budget <= 0 ? 0 : budget / 200;
	const limit = (n: number) => (scale <= 0 ? 0 : Math.max(1, Math.round(n * scale)));

	const counts = (db
		.prepare('SELECT kind, status, COUNT(*) AS n FROM items WHERE board_id = ? GROUP BY kind, status')
		.all(board_id) as { kind: string; status: string; n: number }[]);
	const totalItems = counts.reduce((s, c) => s + c.n, 0);
	const byKind: Record<string, number> = {};
	const byStatus: Record<string, number> = {};
	for (const c of counts) {
		byKind[c.kind] = (byKind[c.kind] ?? 0) + c.n;
		byStatus[c.status] = (byStatus[c.status] ?? 0) + c.n;
	}
	const countsLines = [
		`- by kind: ${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(', ') || '(none)'}`,
		`- by status: ${Object.entries(byStatus).map(([k, n]) => `${k} ${n}`).join(', ') || '(none)'}`
	];

	const unresolved = (
		db
			.prepare(
				`SELECT COUNT(*) AS n FROM decisions d JOIN items i ON i.id = d.item_id
				 WHERE i.board_id = ? AND d.status = 'active' AND d.choice IS NULL`
			)
			.get(board_id) as { n: number }
	).n;
	countsLines.push(`- unresolved_decisions: ${unresolved}`);

	const openTasks = (db
		.prepare(
			`SELECT title, status FROM items WHERE board_id = ?
			 AND kind IN ('task','plan','agent_task')
			 AND status IN ('open','in_progress','blocked') ORDER BY created_at DESC LIMIT ?`
		)
		.all(board_id, limit(12)) as { title: string; status: string }[])
		.map((t) => `- ${t.title} (${t.status})`);

	const decisions = (db
		.prepare(
			`SELECT d.question, d.choice, d.status FROM decisions d
			 JOIN items i ON i.id = d.item_id
			 WHERE i.board_id = ? AND d.status = 'active'
			 ORDER BY d.created_at DESC LIMIT ?`
		)
		.all(board_id, limit(8)) as { question: string; choice: string | null; status: string }[])
		.map((d) => `- ${d.question}${d.choice ? ` → ${d.choice}` : ' (unresolved)'}`);

	const concepts = (db
		.prepare(
			`SELECT c.name, c.definition FROM concepts c
			 JOIN items i ON i.id = c.item_id
			 WHERE i.board_id = ? ORDER BY c.name LIMIT ?`
		)
		.all(board_id, limit(10)) as { name: string; definition: string }[])
		.map((c) => `- ${c.name}: ${c.definition.slice(0, 80)}`);

	const recentMsgs = (db
		.prepare(
			`SELECT m.content, t.title FROM messages m
			 JOIN threads t ON t.id = m.thread_id
			 JOIN items i ON i.id = t.item_id
			 WHERE i.board_id = ?
			 ORDER BY m.created_at DESC LIMIT ?`
		)
		.all(board_id, limit(5)) as { content: string; title: string | null }[])
		.map((m) => `- [${m.title ?? 'thread'}] ${m.content.slice(0, 60)}`);

	const agentTasks = (db
		.prepare(
			`SELECT a.prompt, a.status FROM agent_tasks a
			 JOIN items i ON i.id = a.item_id
			 WHERE i.board_id = ? ORDER BY a.created_at DESC LIMIT ?`
		)
		.all(board_id, limit(5)) as { prompt: string; status: string }[])
		.map((a) => `- ${a.prompt.slice(0, 50)} (${a.status})`);

	const section = (heading: string, lines: string[]) =>
		lines.length > 0 ? `## ${heading}\n${lines.join('\n')}` : '';

	return [
		`# Board brief (${totalItems} items)`,
		section('Counts', countsLines),
		section('Open work', openTasks),
		section('Active decisions', decisions),
		section('Concepts', concepts),
		section('Recent messages', recentMsgs),
		section('Agent tasks', agentTasks)
	]
		.filter(Boolean)
		.join('\n\n');
}
