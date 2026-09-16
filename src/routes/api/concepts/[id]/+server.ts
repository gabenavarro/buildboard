import type { RequestHandler } from '@sveltejs/kit';
import { getConcept, updateConcept, deleteConcept } from '$lib/store.js';
import { json, notFound, handle, readJson } from '../../_util.js';

type Params = { id: string };

export const GET: RequestHandler<Params> = handle(async ({ params }) => {
	const concept = getConcept(params.id);
	if (!concept) return notFound('concept not found');
	return json(concept);
});

export const PATCH: RequestHandler<Params> = handle(async ({ request, params }) => {
	const body = await readJson(request);
	const concept = updateConcept(params.id, body);
	if (!concept) return notFound('concept not found');
	return json(concept);
});

export const DELETE: RequestHandler<Params> = handle(async ({ params }) => {
	const deleted = deleteConcept(params.id);
	if (!deleted) return notFound('concept not found');
	return json({ ok: true });
});
