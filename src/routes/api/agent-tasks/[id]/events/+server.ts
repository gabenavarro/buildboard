import type { RequestHandler } from '@sveltejs/kit';
import { getAgentTask } from '$lib/store.js';
import { getActive } from '$lib/agents/runner.js';
import { notFound } from '../../../_util.js';

type Params = { id: string };

/**
 * Server-Sent Events stream of the agent's output.
 * Replays any transcript already on disk, then tails the live task.
 */
export const GET: RequestHandler<Params> = async ({ params, request }) => {
	const task = getAgentTask(params.id);
	if (!task) return notFound('agent task not found');

	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) {
			const send = (event: string, data: unknown) => {
				controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
			};

			if (task.transcript) send('chunk', { text: task.transcript });

			const done = (payload: Record<string, unknown>) => {
				send('done', payload);
				controller.close();
			};

			if (task.status !== 'running') {
				done({ status: task.status });
				return;
			}

			const activeTask = getActive(task.id);
			if (!activeTask) {
				// Running in DB but not in memory (e.g. server restarted) — report best effort.
				done({ status: 'failed', note: 'process is no longer running' });
				return;
			}

			const onChunk = (text: string) => send('chunk', { text });
			const onDone = (payload: Record<string, unknown>) => done(payload);
			activeTask.emitter.on('chunk', onChunk);
			activeTask.emitter.on('done', onDone);
			// Clean up listeners if the HTTP client disconnects.
			request.signal.addEventListener('abort', () => {
				activeTask.emitter.off('chunk', onChunk);
				activeTask.emitter.off('done', onDone);
			});
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
