import type { RequestHandler } from '@sveltejs/kit';
import { listDecisions, createDecision } from '$lib/store.js';
import { json, badRequest, handle, readJson } from '../_util.js';

export const GET: RequestHandler = handle(async ({ url }) => {
	const item_id = url.searchParams.get('item_id') ?? undefined;
	const status = url.searchParams.get('status') ?? undefined;
	const ref = url.searchParams.get('ref') ?? undefined;
	return json(listDecisions({ item_id, status, ref }));
});

export const POST: RequestHandler = handle(async ({ request }) => {
	const body = await readJson(request);
	if (typeof body.question !== 'string' || body.question.trim() === '') {
		return badRequest('question is required');
	}
	const decision = createDecision({
		item_id: typeof body.item_id === 'string' ? body.item_id : null,
		question: body.question,
		options: Array.isArray(body.options) ? (body.options as string[]) : [],
		choice: typeof body.choice === 'string' ? body.choice : null,
		rationale: typeof body.rationale === 'string' ? body.rationale : '',
		ref: typeof body.ref === 'string' ? body.ref : undefined
	});
	return json(decision, 201);
});
