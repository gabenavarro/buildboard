import type { RequestHandler } from '@sveltejs/kit';
import { getDb } from '$lib/db.js';
import { json } from '../_util.js';

export const GET: RequestHandler = async () => {
	const db = getDb();
	db.prepare('SELECT 1 AS ok').get();
	const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[])
		.map((r) => r.name);
	const counts: Record<string, number> = {};
	for (const t of tables) {
		if (t.startsWith('sqlite_')) continue;
		counts[t] = (db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n;
	}
	return json({ ok: true, tables, counts });
};
