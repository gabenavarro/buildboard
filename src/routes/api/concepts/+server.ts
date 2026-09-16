import type { RequestHandler } from '@sveltejs/kit';
import { listConcepts, createConcept } from '$lib/store.js';
import { json, badRequest, readJson } from '../_util.js';

export const GET: RequestHandler = async () => {
	return json(listConcepts());
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await readJson(request);
	if (typeof body.name !== 'string' || body.name.trim() === '') {
		return badRequest('name is required');
	}
	try {
		const concept = createConcept({
			name: body.name,
			definition: typeof body.definition === 'string' ? body.definition : '',
			details_md: typeof body.details_md === 'string' ? body.details_md : '',
			source: typeof body.source === 'string' ? body.source : null,
			item_id: typeof body.item_id === 'string' ? body.item_id : null
		});
		return json(concept, 201);
	} catch (e) {
		return badRequest(e instanceof Error && e.message.includes('UNIQUE') ? 'concept name already exists' : 'failed to create concept');
	}
};
