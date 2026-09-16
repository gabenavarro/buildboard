import type { RequestHandler } from '@sveltejs/kit';
import { search } from '$lib/search.js';
import { json, handle } from '../_util.js';

export const GET: RequestHandler = handle(async ({ url }) => {
	const q = url.searchParams.get('q') ?? '';
	const limit = Number(url.searchParams.get('limit') ?? '20');
	const source = url.searchParams.get('source') as 'item' | 'decision' | 'concept' | 'message' | null;
	const board = url.searchParams.get('board');
	const hits = search(q, { limit, source: source ?? undefined, board_id: board ?? undefined });
	return json({ query: q, count: hits.length, hits });
});
