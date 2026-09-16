import type { RequestHandler } from '@sveltejs/kit';
import { StoreError } from '../../lib/store.js';

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

/**
 * Expected API failure with an HTTP status. Thrown from route code;
 * mapped to a JSON error response by `handle`.
 */
export class ApiError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
	}
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw new ApiError(400, 'invalid JSON body');
	}
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		throw new ApiError(400, 'JSON object body required');
	}
	return body as Record<string, unknown>;
}

const SQLITE_CONSTRAINTS: { pattern: RegExp; status: number; error: string }[] = [
	{ pattern: /FOREIGN KEY constraint failed/i, status: 400, error: 'foreign key not found' },
	{ pattern: /UNIQUE constraint failed/i, status: 409, error: 'duplicate' },
	{ pattern: /CHECK constraint failed/i, status: 400, error: 'invalid value' }
];

function isSqliteError(e: unknown): e is Error {
	return (
		e instanceof Error &&
		(e.constructor.name === 'SqliteError' ||
			SQLITE_CONSTRAINTS.some((c) => c.pattern.test(e.message)))
	);
}

/**
 * Convert an uncaught error from a route handler into a JSON error response.
 * - ApiError / StoreError: use their status + message as-is
 * - node:sqlite constraint violations: mapped by message
 * - anything else: 500 without leaking internals
 */
export function toErrorResponse(e: unknown): Response {
	if (e instanceof ApiError) return json({ error: e.message }, e.status);
	if (e instanceof StoreError) return json({ error: e.message }, e.status);
	if (isSqliteError(e)) {
		const match = SQLITE_CONSTRAINTS.find((c) => c.pattern.test(e.message));
		if (match) return json({ error: match.error }, match.status);
		return json({ error: 'database error' }, 500);
	}
	console.error(e);
	return json({ error: 'internal server error' }, 500);
}

/**
 * Wrap a route handler so that thrown errors become proper JSON responses
 * instead of SvelteKit's default 500 page.
 */
export function handle<P extends Record<string, string | undefined> = Record<string, string | undefined>>(
	handler: RequestHandler<P>
): RequestHandler<P> {
	return async (event) => {
		try {
			return await handler(event);
		} catch (e) {
			return toErrorResponse(e);
		}
	};
}

export const okHandler: RequestHandler = async () => {
	return json({ ok: true });
};
