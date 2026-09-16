import type { RequestHandler } from '@sveltejs/kit';
import { getAgentTask } from '$lib/store.js';
import { cancelAgentTask } from '$lib/agents/runner.js';
import { json, notFound, handle } from '../../_util.js';

type Params = { id: string };

export const GET: RequestHandler<Params> = handle(async ({ params }) => {
	const task = getAgentTask(params.id);
	if (!task) return notFound('agent task not found');
	return json(task);
});

export const POST: RequestHandler<Params> = handle(async ({ params }) => {
	const task = getAgentTask(params.id);
	if (!task) return notFound('agent task not found');
	if (task.status !== 'running') return json({ ok: false, error: 'task is not running' }, 409);
	const canceled = cancelAgentTask(params.id);
	return json({ ok: canceled });
});
