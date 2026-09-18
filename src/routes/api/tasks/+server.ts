import type { RequestHandler } from '@sveltejs/kit';
import { recordTask } from '$lib/store.js';
import { json, badRequest, handle, readJson } from '../_util.js';

export const POST: RequestHandler = handle(async ({ request }) => {
	const body = await readJson(request);
	if (typeof body.what !== 'string' || body.what.trim() === '') {
		return badRequest('what is required');
	}
	const result = recordTask({
		what: body.what,
		body_md: typeof body.body_md === 'string' ? body.body_md : undefined,
		ref: typeof body.ref === 'string' ? body.ref : undefined,
		board_id: typeof body.board_id === 'string' ? body.board_id : undefined
	});
	return json(result, 201);
});
