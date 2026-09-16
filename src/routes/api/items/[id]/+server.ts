import type { RequestHandler } from '@sveltejs/kit';
import { getItem, updateItem, deleteItem } from '$lib/store.js';
import { json, badRequest, notFound, readJson } from '../../_util.js';

type Params = { id: string };

export const GET: RequestHandler<Params> = async ({ params }) => {
	const item = getItem(params.id);
	if (!item) return notFound('item not found');
	return json(item);
};

export const PATCH: RequestHandler<Params> = async ({ request, params }) => {
	const body = await readJson(request);
	try {
		const item = updateItem(params.id, body);
		if (!item) return notFound('item not found');
		return json(item);
	} catch (e) {
		return badRequest(e instanceof Error ? e.message : 'invalid update');
	}
};

export const DELETE: RequestHandler<Params> = async ({ params }) => {
	const deleted = deleteItem(params.id);
	if (!deleted) return notFound('item not found');
	return json({ ok: true });
};
