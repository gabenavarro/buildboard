import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RequestHandler } from '@sveltejs/kit';
import { cleanupDb, cleanupTempDirs, freshDb } from '../test/testdb.js';

beforeEach(() => {
	freshDb();
});

afterEach(() => {
	cleanupDb();
	delete process.env.BUILDBOARD_AGENT_CMD;
	delete process.env.BUILDBOARD_AGENT_TIMEOUT_MS;
	delete process.env.BUILDBOARD_AGENT_KILL_MS;
});

afterAll(() => {
	cleanupTempDirs();
});

async function waitFor(pred: () => boolean, timeoutMs = 10000, label = 'condition'): Promise<void> {
	const start = Date.now();
	while (!pred()) {
		if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
		await new Promise((r) => setTimeout(r, 25));
	}
}

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

async function readSse(res: Response): Promise<{ chunks: string[]; dones: number }> {
	const reader = res.body!.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	const chunks: string[] = [];
	let dones = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		let m: number;
		while ((m = buf.indexOf('\n\n')) >= 0) {
			const frame = buf.slice(0, m);
			buf = buf.slice(m + 2);
			const eventLine = frame.split('\n').find((l) => l.startsWith('event: '));
			const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
			if (!eventLine || !dataLine) continue;
			const name = eventLine.slice(7);
			const data = JSON.parse(dataLine.slice(6)) as { text?: string };
			if (name === 'chunk') chunks.push(data.text ?? '');
			if (name === 'done') dones++;
		}
	}
	return { chunks, dones };
}

describe('agent runner hardening', () => {
	it('kills a hung agent on timeout and finishes failed with a timeout note', async () => {
		process.env.BUILDBOARD_AGENT_CMD = 'sleep 30';
		process.env.BUILDBOARD_AGENT_TIMEOUT_MS = '500';
		const { startAgentTask, getActive, isActive } = await import('./agents/runner.js');
		const { getAgentTask } = await import('./store.js');

		const task = startAgentTask({ prompt: 'hang forever' });
		const entry = getActive(task.id)!;
		const payload = await new Promise<Record<string, unknown>>((resolve) =>
			entry.emitter.on('done', resolve)
		);

		expect(payload.status).toBe('failed');
		expect(payload.note).toBe('[timed out after 500ms]');
		const row = getAgentTask(task.id)!;
		expect(row.status).toBe('failed');
		expect(row.transcript ?? '').toContain('[timed out after 500ms]');
		expect(isActive(task.id)).toBe(false);
		expect(entry.exited).toBe(true);
	}, 15000);

	it('escalates to SIGKILL when the child traps SIGTERM', async () => {
		// The long-lived process itself traps SIGTERM (a bare `sleep 30` under
		// `trap "" TERM` would die, because its child sleep does not trap).
		process.env.BUILDBOARD_AGENT_CMD = "bash -c 'trap \"\" TERM; while :; do sleep 1; done'";
		// Fast escalation so the test does not race a 5s wall-clock timer.
		process.env.BUILDBOARD_AGENT_KILL_MS = '500';
		const { startAgentTask, cancelAgentTask, getActive } = await import('./agents/runner.js');
		const { getAgentTask } = await import('./store.js');

		const task = startAgentTask({ prompt: 'stall' });
		const entry = getActive(task.id)!;
		await waitFor(() => entry.proc?.pid != null, 5000, 'child to start');
		// Let the child exec and install its SIGTERM trap before we cancel,
		// so the escalation path is what we are measuring.
		await new Promise((r) => setTimeout(r, 500));

		const groupAlive = (): boolean => {
			try {
				process.kill(-entry.proc!.pid!, 0);
				return true;
			} catch {
				return false;
			}
		};
		const t0 = Date.now();
		expect(cancelAgentTask(task.id)).toBe(true);
		// SIGTERM is ignored, so the group can only die via the escalation
		// SIGKILL. Poll for exit with margin instead of a fixed wall-clock band.
		await waitFor(() => !groupAlive(), 6000, 'process group to die');
		const elapsed = Date.now() - t0;

		// Death must come after the 500ms escalation delay, well inside the 6s window.
		expect(elapsed).toBeGreaterThanOrEqual(400);
		expect(elapsed).toBeLessThan(6500);
		expect(getAgentTask(task.id)!.status).toBe('canceled');
	}, 15000);

	it('refuses a second task for an item with a running task (409, no dangling row)', async () => {
		process.env.BUILDBOARD_AGENT_CMD = 'sleep 30';
		const { startAgentTask, cancelAgentTask } = await import('./agents/runner.js');
		const { createItem, listAgentTasks, getRunningAgentTaskForItem, StoreError } = await import('./store.js');

		const item = createItem({ title: 'anchor' });
		const first = startAgentTask({ item_id: item.id, prompt: 'first' });
		expect(getRunningAgentTaskForItem(item.id)?.id).toBe(first.id);

		try {
			startAgentTask({ item_id: item.id, prompt: 'second' });
			expect.unreachable('should have thrown');
		} catch (e) {
			expect(e).toBeInstanceOf(StoreError);
			expect((e as { status?: number }).status).toBe(409);
		}

		// same guard via the API route, which maps StoreError(409) to a 409 response
		const { POST } = await import('../routes/api/agent-tasks/+server.js');
		const res = await POST(event({}, jsonBody({ item_id: item.id, prompt: 'third' })));
		expect(res.status).toBe(409);
		expect(((await res.json()) as { error: string }).error).toContain('already running');

		expect(listAgentTasks().filter((t) => t.item_id === item.id)).toHaveLength(1);
		expect(cancelAgentTask(first.id)).toBe(true);
	}, 15000);

	it('replays the in-memory transcript on reconnect and emits exactly one done', async () => {
		// The command line is parsed by sh, so the double quotes must be
		// escaped for the emitted NDJSON to survive the shell.
		process.env.BUILDBOARD_AGENT_CMD =
			'echo {\\"type\\":\\"text\\",\\"part\\":{\\"type\\":\\"text\\",\\"text\\":\\"hello\\"}}; sleep 60';
		const { startAgentTask, cancelAgentTask, getActive } = await import('./agents/runner.js');
		const { GET } = await import('../routes/api/agent-tasks/[id]/events/+server.js');

		const task = startAgentTask({ prompt: 'stream' });
		const entry = getActive(task.id)!;
		await waitFor(() => entry.transcript === 'hello', 5000, 'transcript to accumulate');

		// first client attached live; second client connects mid-run (the reconnect case)
		const res1 = await GET(event({ id: task.id }));
		const res2 = await GET(event({ id: task.id }));
		expect(cancelAgentTask(task.id)).toBe(true);

		const s1 = await readSse(res1);
		const s2 = await readSse(res2);
		expect(s1.chunks.join('')).toContain('hello');
		expect(s2.chunks.join('')).toContain('hello');
		expect(s1.dones).toBe(1);
		expect(s2.dones).toBe(1);
	}, 15000);

	it('reconciles stale running tasks on startup so the 409 guard can wedge no item', async () => {
		const { createItem, createAgentTask, getAgentTask, getRunningAgentTaskForItem, reconcileStaleAgentTasks } = await import('./store.js');
		const item = createItem({ title: 'work', kind: 'task' });
		const orphan = createAgentTask({ item_id: item.id, prompt: 'will be orphaned' });
		expect(orphan.status).toBe('running');
		expect(getRunningAgentTaskForItem(item.id)?.id).toBe(orphan.id);

		// Simulate a server restart: the in-memory table is gone, only the DB row remains.
		const n = reconcileStaleAgentTasks();
		expect(n).toBe(1);
		const after = getAgentTask(orphan.id)!;
		expect(after.status).toBe('failed');
		expect(after.finished_at).toBeTruthy();
		expect(after.transcript ?? '').toContain('server restarted');
		expect(getRunningAgentTaskForItem(item.id)).toBeNull();

		// The item is unblocked: a new spawn for the same item succeeds.
		process.env.BUILDBOARD_AGENT_CMD = 'sleep 30';
		const runner = await import('./agents/runner.js');
		const fresh = runner.startAgentTask({ item_id: item.id, prompt: 'again' });
		expect(fresh.status).toBe('running');
		expect(runner.cancelAgentTask(fresh.id)).toBe(true);
	});
});
