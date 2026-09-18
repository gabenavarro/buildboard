import type { RequestHandler } from '@sveltejs/kit';
import { resolveDecision } from '$lib/store.js';
import { json, badRequest, handle, readJson } from '../../../_util.js';

type Params = { id: string };

export const POST: RequestHandler<Params> = handle(async ({ request, params }) => {
	const body = await readJson(request);
	if (typeof body.choice !== 'string' || body.choice.trim() === '') {
		return badRequest('choice is required');
	}
	const result = resolveDecision(params.id, body.choice, typeof body.rationale === 'string' ? body.rationale : undefined);
	return json(result);
});
