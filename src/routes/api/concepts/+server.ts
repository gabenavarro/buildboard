import type { RequestHandler } from '@sveltejs/kit';
import { listConcepts, createConcept } from '$lib/store.js';
import { json, badRequest, handle, readJson } from '../_util.js';

export const GET: RequestHandler = handle(async () => {
	return json(listConcepts());
});

export const POST: RequestHandler = handle(async ({ request }) => {
	const body = await readJson(request);
	if (typeof body.name !== 'string' || body.name.trim() === '') {
		return badRequest('name is required');
	}
	const concept = createConcept({
		name: body.name,
		definition: typeof body.definition === 'string' ? body.definition : '',
		details_md: typeof body.details_md === 'string' ? body.details_md : '',
		source: typeof body.source === 'string' ? body.source : null,
		item_id: typeof body.item_id === 'string' ? body.item_id : null,
		ref: typeof body.ref === 'string' ? body.ref : undefined
	});
	return json(concept, 201);
});
