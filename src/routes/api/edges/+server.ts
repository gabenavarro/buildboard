import type { RequestHandler } from '@sveltejs/kit';
import { listEdges, createEdge } from '$lib/store.js';
import { json, badRequest, readJson } from '../_util.js';

export const GET: RequestHandler = async () => {
	return json(listEdges());
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await readJson(request);
	const from_id = body.from_id;
	const to_id = body.to_id;
	if (typeof from_id !== 'string' || typeof to_id !== 'string') {
		return badRequest('from_id and to_id are required');
	}
	const edge = createEdge({
		from_id,
		to_id,
		kind: typeof body.kind === 'string' ? body.kind : undefined,
		label: typeof body.label === 'string' ? body.label : undefined
	});
	return json(edge, 201);
};
