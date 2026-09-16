import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestHandler } from '@sveltejs/kit';

const tmpRoot = mkdtempSync(path.join(tmpdir(), 'buildboard-api-test-'));
let dbFile: string;

beforeEach(() => {
	dbFile = path.join(tmpRoot, `api-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
	process.env.BUILDBOARD_DB = dbFile;
	vi.resetModules();
});

afterEach(() => {
	delete process.env.BUILDBOARD_DB;
});

function event<P extends Record<string, string> = Record<string, string>>(
	params: P,
	request?: Request,
	url?: URL
): Parameters<RequestHandler<P>>[0] {
	return {
		request: request ?? new Request('http://localhost/api'),
		params,
		url: url ?? new URL('http://localhost/api')
	} as unknown as Parameters<RequestHandler<P>>[0];
}

function jsonBody(body: unknown): Request {
	return new Request('http://localhost/api', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
}

describe('API error handling', () => {
	it('returns 400 for malformed JSON', async () => {
		const { POST } = await import('./items/+server.js');
		const req = new Request('http://localhost/api/items', { method: 'POST', body: '{not json' });
		const res = await POST(event({}, req));
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'invalid JSON body' });
	});

	it('returns 400 for a non-object JSON body', async () => {
		const { POST } = await import('./items/+server.js');
		const res = await POST(event({}, jsonBody(['a', 'b'])));
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'JSON object body required' });
	});

	it('item create/get/patch round-trip', async () => {
		const { POST } = await import('./items/+server.js');
		const { GET, PATCH } = await import('./items/[id]/+server.js');

		const created = await POST(event({}, jsonBody({ title: 'hello', kind: 'task' })));
		expect(created.status).toBe(201);
		const item = (await created.json()) as { id: string; title: string };
		expect(item.title).toBe('hello');

		const fetched = await GET(event({ id: item.id }));
		expect(fetched.status).toBe(200);
		expect(((await fetched.json()) as { title: string }).title).toBe('hello');

		const patched = await PATCH(event({ id: item.id }, jsonBody({ title: 'hi', status: 'done' })));
		expect(patched.status).toBe(200);
		const updated = (await patched.json()) as { title: string; status: string };
		expect(updated.title).toBe('hi');
		expect(updated.status).toBe('done');
	});

	it('returns 404 for unknown item on GET/PATCH/DELETE', async () => {
		const { GET, PATCH, DELETE } = await import('./items/[id]/+server.js');
		expect((await GET(event({ id: 'missing' }))).status).toBe(404);
		expect((await PATCH(event({ id: 'missing' }, jsonBody({ title: 'x' })))).status).toBe(404);
		expect((await DELETE(event({ id: 'missing' }))).status).toBe(404);
	});

	it('rejects item create/update with a missing parent or board (404)', async () => {
		const { POST } = await import('./items/+server.js');
		expect((await POST(event({}, jsonBody({ title: 'x', parent_id: 'missing' })))).status).toBe(404);
		expect((await POST(event({}, jsonBody({ title: 'x', board_id: 'missing' })))).status).toBe(404);
	});

	it('returns 404 when creating an edge with a missing endpoint', async () => {
		const { createItem } = await import('../../lib/store.js');
		const { POST } = await import('./edges/+server.js');
		const a = createItem({ title: 'a' });
		const res = await POST(event({}, jsonBody({ from_id: a.id, to_id: 'missing' })));
		expect(res.status).toBe(404);
		expect(((await res.json()) as { error: string }).error).toContain('to item not found');
	});

	it('returns 404 for unknown references on threads, decisions, agent tasks', async () => {
		const { POST: postThread } = await import('./threads/+server.js');
		expect((await postThread(event({}, jsonBody({ title: 't', item_id: 'missing' })))).status).toBe(404);

		const { POST: postDecision } = await import('./decisions/+server.js');
		expect(
			(await postDecision(event({}, jsonBody({ question: 'q', item_id: 'missing' })))).status
		).toBe(404);

		const { GET: getTask } = await import('./agent-tasks/[id]/+server.js');
		expect((await getTask(event({ id: 'missing' }))).status).toBe(404);
	});

	it('returns 400 for an invalid decision status on PATCH', async () => {
		const { createDecision } = await import('../../lib/store.js');
		const { PATCH } = await import('./decisions/[id]/+server.js');
		const d = createDecision({ question: 'q' });
		const res = await PATCH(event({ id: d.id }, jsonBody({ status: 'bogus' })));
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: string }).error).toContain('invalid status');
	});

	it('returns 400 for an invalid item kind/status on PATCH', async () => {
		const { createItem } = await import('../../lib/store.js');
		const { PATCH } = await import('./items/[id]/+server.js');
		const item = createItem({ title: 'x' });
		expect((await PATCH(event({ id: item.id }, jsonBody({ kind: 'nope' })))).status).toBe(400);
		expect((await PATCH(event({ id: item.id }, jsonBody({ status: 'nope' })))).status).toBe(400);
	});

	it('returns 409 for a duplicate concept name (create and update)', async () => {
		const { POST } = await import('./concepts/+server.js');
		const { PATCH } = await import('./concepts/[id]/+server.js');
		const first = await POST(event({}, jsonBody({ name: 'SQLite' })));
		expect(first.status).toBe(201);

		const duplicate = await POST(event({}, jsonBody({ name: 'SQLite' })));
		expect(duplicate.status).toBe(409);
		expect(((await duplicate.json()) as { error: string }).error).toBe('duplicate');

		const second = await POST(event({}, jsonBody({ name: 'Postgres' })));
		expect(second.status).toBe(201);
		const secondId = ((await second.json()) as { id: string }).id;
		const collision = await PATCH(event({ id: secondId }, jsonBody({ name: 'SQLite' })));
		expect(collision.status).toBe(409);
		expect(((await collision.json()) as { error: string }).error).toContain('already exists');
	});

	it('returns 409 for a duplicate board name', async () => {
		const { POST } = await import('./boards/+server.js');
		// the default board is seeded with the name "Main board"
		const res = await POST(event({}, jsonBody({ name: 'Main board' })));
		expect(res.status).toBe(409);
		expect(((await res.json()) as { error: string }).error).toContain('already exists');

		const created = await POST(event({}, jsonBody({ name: 'Fresh board' })));
		expect(created.status).toBe(201);
		const { PATCH: patchBoard } = await import('./boards/[id]/+server.js');
		const renamed = await POST(event({}, jsonBody({ name: 'Copy' })));
		const copyId = ((await renamed.json()) as { id: string }).id;
		expect((await patchBoard(event({ id: copyId }, jsonBody({ name: 'Fresh board' })))).status).toBe(409);
	});

	it('maps raw sqlite constraint errors by message', async () => {
		const { toErrorResponse } = await import('./_util.js');
		const fk = toErrorResponse(new Error('FOREIGN KEY constraint failed'));
		expect(fk.status).toBe(400);
		expect(await fk.json()).toEqual({ error: 'foreign key not found' });
		const uniq = toErrorResponse(new Error('UNIQUE constraint failed: concepts.name'));
		expect(uniq.status).toBe(409);
		expect(await uniq.json()).toEqual({ error: 'duplicate' });
		const check = toErrorResponse(new Error("CHECK constraint failed: items.kind"));
		expect(check.status).toBe(400);
		expect(await check.json()).toEqual({ error: 'invalid value' });
		const boom = toErrorResponse(new Error('mystery failure'));
		expect(boom.status).toBe(500);
	});
});
