import type { RequestHandler } from '@sveltejs/kit';
import { buildBrief } from '$lib/digest.js';
import { json } from '../_util.js';

export const GET: RequestHandler = async () => {
	const brief = buildBrief();
	const chars = brief.length;
	return json({ brief, chars, approx_tokens: Math.round(chars / 4) });
};
