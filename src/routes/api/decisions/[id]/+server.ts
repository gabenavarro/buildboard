import type { RequestHandler } from '@sveltejs/kit';
import { getDecision, updateDecision, deleteDecision } from '$lib/store.js';
import { json, notFound, readJson } from '../../_util.js';

type Params = { id: string };

export const GET: RequestHandler<Params> = async ({ params }) => {
	const decision = getDecision(params.id);
	if (!decision) return notFound('decision not found');
	return json(decision);
};

export const PATCH: RequestHandler<Params> = async ({ request, params }) => {
	const body = await readJson(request);
	const decision = updateDecision(params.id, body);
	if (!decision) return notFound('decision not found');
	return json(decision);
};

export const DELETE: RequestHandler<Params> = async ({ params }) => {
	const deleted = deleteDecision(params.id);
	if (!deleted) return notFound('decision not found');
	return json({ ok: true });
};
