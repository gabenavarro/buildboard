import type { RequestHandler } from '@sveltejs/kit';
import { resolveRef } from '$lib/store.js';
import { json, notFound, handle } from '../../_util.js';

type Params = { ref: string };

export const GET: RequestHandler<Params> = handle(async ({ params }) => {
	const resolved = resolveRef(params.ref);
	if (!resolved) return notFound('ref not found');
	return json(resolved);
});
