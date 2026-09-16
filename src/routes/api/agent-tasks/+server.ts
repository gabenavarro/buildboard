import type { RequestHandler } from '@sveltejs/kit';
import { listAgentTasks } from '$lib/store.js';
import { getItem } from '$lib/store.js';
import { buildPrompt } from '$lib/agents/prompt.js';
import { startAgentTask } from '$lib/agents/runner.js';
import { json, badRequest, notFound, handle, readJson } from '../_util.js';

export const GET: RequestHandler = handle(async ({ url }) => {
	const limit = Number(url.searchParams.get('limit') ?? '50');
	const item_id = url.searchParams.get('item_id') ?? undefined;
	return json(listAgentTasks(limit, item_id ? { item_id } : {}));
});

export const POST: RequestHandler = handle(async ({ request }) => {
	const body = await readJson(request);
	const agent = typeof body.agent === 'string' ? body.agent : undefined;
	const model = typeof body.model === 'string' ? body.model : undefined;
	let prompt = typeof body.prompt === 'string' ? body.prompt : '';
	const item_id = typeof body.item_id === 'string' ? body.item_id : null;

	if (item_id) {
		const item = getItem(item_id);
		if (!item) return notFound('item not found');
		if (!prompt) prompt = buildPrompt(item, typeof body.instruction === 'string' ? body.instruction : undefined);
	}
	if (!prompt.trim()) return badRequest('prompt is required (or provide item_id)');

	const task = startAgentTask({ item_id, prompt, agent: agent ?? null, model: model ?? null });
	return json(task, 201);
});
