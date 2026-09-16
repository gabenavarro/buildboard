import type { RequestHandler } from '@sveltejs/kit';
import { getThread, deleteMessage } from '$lib/store.js';
import { json, notFound, handle } from '../../../../_util.js';

type Params = { id: string; mid: string };

export const DELETE: RequestHandler<Params> = handle(async ({ params }) => {
	if (!getThread(params.id)) return notFound('thread not found');
	const deleted = deleteMessage(params.id, params.mid);
	if (!deleted) return notFound('message not found');
	return json({ ok: true });
});
