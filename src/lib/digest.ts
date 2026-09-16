import { getDb } from './db.js';

/**
 * Build a compact context digest (~200 tokens) of the whole board.
 * Designed to be handed to an agent so it can orient itself without
 * pulling the full database. Returns plain text/markdown.
 */
export function buildBrief(): string {
	const db = getDb();

	const counts = (db
		.prepare('SELECT kind, status, COUNT(*) AS n FROM items GROUP BY kind, status')
		.all() as { kind: string; status: string; n: number }[]);
	const totalItems = counts.reduce((s, c) => s + c.n, 0);

	const openTasks = (db
		.prepare(`SELECT title, status FROM items WHERE kind IN ('task','plan','agent_task')
			AND status IN ('open','in_progress','blocked') ORDER BY created_at DESC LIMIT 12`)
		.all() as { title: string; status: string }[])
		.map((t) => `- ${t.title} (${t.status})`);

	const decisions = (db
		.prepare(`SELECT question, choice, status FROM decisions WHERE status = 'active'
			ORDER BY created_at DESC LIMIT 8`)
		.all() as { question: string; choice: string | null; status: string }[])
		.map((d) => `- ${d.question}${d.choice ? ` → ${d.choice}` : ' (unresolved)'}`);

	const concepts = (db
		.prepare('SELECT name, definition FROM concepts ORDER BY name LIMIT 10')
		.all() as { name: string; definition: string }[])
		.map((c) => `- ${c.name}: ${c.definition.slice(0, 80)}`);

	const recentMsgs = (db
		.prepare(`SELECT m.content, t.title FROM messages m
			LEFT JOIN threads t ON t.id = m.thread_id
			ORDER BY m.created_at DESC LIMIT 5`)
		.all() as { content: string; title: string | null }[])
		.map((m) => `- [${m.title ?? 'thread'}] ${m.content.slice(0, 60)}`);

	const agentTasks = (db
		.prepare(`SELECT prompt, status FROM agent_tasks ORDER BY created_at DESC LIMIT 5`)
		.all() as { prompt: string; status: string }[])
		.map((a) => `- ${a.prompt.slice(0, 50)} (${a.status})`);

	const section = (heading: string, lines: string[]) =>
		lines.length > 0 ? `## ${heading}\n${lines.join('\n')}` : '';

	return [
		`# Board brief (${totalItems} items)`,
		section('Open work', openTasks),
		section('Active decisions', decisions),
		section('Concepts', concepts),
		section('Recent messages', recentMsgs),
		section('Agent tasks', agentTasks)
	]
		.filter(Boolean)
		.join('\n\n');
}
