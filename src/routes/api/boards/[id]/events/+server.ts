import type { RequestHandler } from '@sveltejs/kit';
import { onBoardChange } from '$lib/board-events.js';
import { getBoard } from '$lib/store.js';

type Params = { id: string };

/**
 * Server-Sent Events stream of board changes. The canvas subscribes and does a
 * lightweight diff-refresh on each event, so agent/CLI writes from anywhere are
 * visible without a manual reload. A periodic keepalive ping keeps proxies from
 * closing the idle connection.
 */
export const GET: RequestHandler<Params> = async ({ params, request }) => {
	const board = getBoard(params.id);
	if (!board) {
		return new Response(JSON.stringify({ error: `board not found: ${params.id}` }), {
			status: 404,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) {
			const send = (event: string, data: unknown) => {
				controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
			};

			send('hello', { board_id: params.id, at: new Date().toISOString() });

			const onChange = ({ type }: { type: string }) => send('change', { type });

			const unsub = onBoardChange(params.id, onChange);
			const ping = setInterval(() => send('ping', {}), 15000);
			request.signal.addEventListener('abort', () => {
				clearInterval(ping);
				unsub();
				controller.close();
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
