import type { RequestHandler } from '@sveltejs/kit';
import { recordDecision } from '$lib/store.js';
import { json, badRequest, handle, readJson } from '../_util.js';

export const POST: RequestHandler = handle(async ({ request }) => {
	const body = await readJson(request);
	if (typeof body.question !== 'string' || body.question.trim() === '') {
		return badRequest('question is required');
	}
	const result = recordDecision({
		question: body.question,
		options: Array.isArray(body.options) ? (body.options as string[]) : [],
		why: typeof body.why === 'string' ? body.why : undefined,
		rec: typeof body.rec === 'string' ? body.rec : undefined,
		ref: typeof body.ref === 'string' ? body.ref : undefined,
		board_id: typeof body.board_id === 'string' ? body.board_id : undefined
	});
	return json(result, 201);
});
