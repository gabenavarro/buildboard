import type { RequestHandler } from '@sveltejs/kit';
import { getItem, updateItem, deleteItem } from '$lib/store.js';
import { json, notFound, handle, readJson } from '../../_util.js';

type Params = { id: string };

export const GET: RequestHandler<Params> = handle(async ({ params }) => {
	const item = getItem(params.id);
	if (!item) return notFound('item not found');
	return json(item);
});

export const PATCH: RequestHandler<Params> = handle(async ({ request, params }) => {
	const body = await readJson(request);
	const item = updateItem(params.id, body);
	if (!item) return notFound('item not found');
	return json(item);
});

export const DELETE: RequestHandler<Params> = handle(async ({ params }) => {
	const deleted = deleteItem(params.id);
	if (!deleted) return notFound('item not found');
	return json({ ok: true });
});
