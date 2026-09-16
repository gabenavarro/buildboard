import type { RequestHandler } from '@sveltejs/kit';
import { listItems, createItem, validateCreateItem } from '$lib/store.js';
import { json, badRequest, readJson } from '../_util.js';

export const GET: RequestHandler = async ({ url }) => {
	const items = listItems({
		kind: url.searchParams.get('kind') ?? undefined,
		tag: url.searchParams.get('tag') ?? undefined,
		status: url.searchParams.get('status') ?? undefined,
		parent_id: url.searchParams.get('parent_id') ?? undefined
	});
	return json(items);
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await readJson(request);
	const validated = validateCreateItem(body);
	if (!validated.ok) return badRequest(validated.error);
	const item = createItem(validated.value);
	return json(item, 201);
};
