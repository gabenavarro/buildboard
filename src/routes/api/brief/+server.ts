import type { RequestHandler } from '@sveltejs/kit';
import { buildBrief } from '$lib/digest.js';
import { json, handle } from '../_util.js';

export const GET: RequestHandler = handle(async ({ url }) => {
	const board = url.searchParams.get('board');
	const rawTokens = url.searchParams.get('tokens');
	const tokens = rawTokens !== null ? Number(rawTokens) : NaN;
	const brief = buildBrief({
		board_id: board || undefined,
		token_budget: Number.isFinite(tokens) && tokens > 0 ? tokens : undefined
	});
	const chars = brief.length;
	return json({ brief, chars, approx_tokens: Math.round(chars / 4) });
});
