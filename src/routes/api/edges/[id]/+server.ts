import type { RequestHandler } from '@sveltejs/kit';
import { getEdge, updateEdge, deleteEdge } from '$lib/store.js';
import { json, notFound, handle, readJson } from '../../_util.js';

type Params = { id: string };

export const GET: RequestHandler<Params> = handle(async ({ params }) => {
	const edge = getEdge(params.id);
	if (!edge) return notFound('edge not found');
	return json(edge);
});

export const PATCH: RequestHandler<Params> = handle(async ({ request, params }) => {
	const body = await readJson(request);
	const edge = updateEdge(params.id, body);
	if (!edge) return notFound('edge not found');
	return json(edge);
});

export const DELETE: RequestHandler<Params> = handle(async ({ params }) => {
	const deleted = deleteEdge(params.id);
	if (!deleted) return notFound('edge not found');
	return json({ ok: true });
});
