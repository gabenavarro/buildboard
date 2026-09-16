import type { RequestHandler } from '@sveltejs/kit';
import { listThreads, createThread } from '$lib/store.js';
import { json, badRequest, handle, readJson } from '../_util.js';

export const GET: RequestHandler = handle(async ({ url }) => {
	const item_id = url.searchParams.get('item_id') ?? undefined;
	return json(listThreads(item_id));
});

export const POST: RequestHandler = handle(async ({ request }) => {
	const body = await readJson(request);
	if (typeof body.title !== 'string' || body.title.trim() === '') {
		return badRequest('title is required');
	}
	const thread = createThread(body.title, typeof body.item_id === 'string' ? body.item_id : null);
	return json(thread, 201);
});
