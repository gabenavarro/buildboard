import type { RequestHandler } from '@sveltejs/kit';
import { listItems, createItem, validateCreateItem } from '$lib/store.js';
import { json, badRequest, handle, readJson } from '../_util.js';

export const GET: RequestHandler = handle(async ({ url }) => {
	const items = listItems({
		kind: url.searchParams.get('kind') ?? undefined,
		tag: url.searchParams.get('tag') ?? undefined,
		status: url.searchParams.get('status') ?? undefined,
		parent_id: url.searchParams.get('parent_id') ?? undefined,
		board_id: url.searchParams.get('board') ?? undefined
	});
	return json(items);
});

export const POST: RequestHandler = handle(async ({ request, url }) => {
	const body = await readJson(request);
	const board = url.searchParams.get('board');
	if (board) body.board_id = board;
	const validated = validateCreateItem(body);
	if (!validated.ok) return badRequest(validated.error);
	const item = createItem(validated.value);
	return json(item, 201);
});
