import type { RequestHandler } from '@sveltejs/kit';
import { moveItem } from '$lib/store.js';
import { json, badRequest, notFound, handle, readJson } from '../../../_util.js';

type Params = { id: string };

export const POST: RequestHandler<Params> = handle(async ({ request, params }) => {
	const body = await readJson(request);
	const board_id = body.board_id;
	if (typeof board_id !== 'string' || board_id.trim() === '') {
		return badRequest('board_id is required');
	}
	const item = moveItem(params.id, board_id);
	if (!item) return notFound('item not found');
	return json(item);
});
