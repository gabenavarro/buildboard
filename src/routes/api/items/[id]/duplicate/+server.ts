import type { RequestHandler } from '@sveltejs/kit';
import { duplicateItem } from '$lib/store.js';
import { json, notFound, handle, readJson } from '../../../_util.js';

type Params = { id: string };

export const POST: RequestHandler<Params> = handle(async ({ request, params }) => {
	const body = await readJson(request);
	const item = duplicateItem(params.id, {
		board_id: typeof body.board_id === 'string' ? body.board_id : undefined,
		title_suffix: typeof body.title_suffix === 'string' ? body.title_suffix : undefined
	});
	if (!item) return notFound('item not found');
	return json(item, 201);
});
