import type { RequestHandler } from '@sveltejs/kit';
import { listMessages, createMessage, getThread } from '$lib/store.js';
import type { MessageRole } from '$lib/db.js';
import { json, badRequest, notFound, readJson } from '../../../_util.js';

const ROLES: MessageRole[] = ['user', 'agent', 'subagent', 'system'];

type Params = { id: string };

export const GET: RequestHandler<Params> = async ({ params, url }) => {
	const thread = getThread(params.id);
	if (!thread) return notFound('thread not found');
	const limit = Number(url.searchParams.get('limit') ?? '200');
	const before_id = url.searchParams.get('before_id') ?? undefined;
	return json(listMessages(params.id, limit, before_id));
};

export const POST: RequestHandler<Params> = async ({ request, params }) => {
	const thread = getThread(params.id);
	if (!thread) return notFound('thread not found');
	const body = await readJson(request);
	if (typeof body.content !== 'string' || body.content.trim() === '') {
		return badRequest('content is required');
	}
	const role = (body.role ?? 'user') as MessageRole;
	if (!ROLES.includes(role)) return badRequest(`role must be one of: ${ROLES.join(', ')}`);
	const message = createMessage({
		thread_id: params.id,
		role,
		content: body.content,
		meta: typeof body.meta === 'string' ? body.meta : null
	});
	return json(message, 201);
};
