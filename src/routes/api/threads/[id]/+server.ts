import type { RequestHandler } from '@sveltejs/kit';
import { getThread, deleteThread } from '$lib/store.js';
import { json, notFound, handle } from '../../_util.js';

type Params = { id: string };

export const GET: RequestHandler<Params> = handle(async ({ params }) => {
	const thread = getThread(params.id);
	if (!thread) return notFound('thread not found');
	return json(thread);
});

export const DELETE: RequestHandler<Params> = handle(async ({ params }) => {
	const deleted = deleteThread(params.id);
	if (!deleted) return notFound('thread not found');
	return json({ ok: true });
});
