import type { RequestHandler } from '@sveltejs/kit';

export function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

export function badRequest(error: string): Response {
	return json({ error }, 400);
}

export function notFound(error = 'not found'): Response {
	return json({ error }, 404);
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
	try {
		const body = await request.json();
		if (typeof body !== 'object' || body === null || Array.isArray(body)) {
			throw new Error('JSON object body required');
		}
		return body as Record<string, unknown>;
	} catch {
		throw new Error('invalid JSON body');
	}
}

export const okHandler: RequestHandler = async () => {
	return json({ ok: true });
};
