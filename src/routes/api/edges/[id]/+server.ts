import type { RequestHandler } from '@sveltejs/kit';
import { deleteEdge } from '$lib/store.js';
import { json, notFound, handle } from '../../_util.js';

type Params = { id: string };

export const DELETE: RequestHandler<Params> = handle(async ({ params }) => {
	const deleted = deleteEdge(params.id);
	if (!deleted) return notFound('edge not found');
	return json({ ok: true });
});
