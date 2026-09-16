import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';

import {
	createAgentTask,
	finishAgentTask,
	updateItem,
	getRunningAgentTaskForItem,
	getItem,
	reconcileStaleAgentTasks,
	StoreError
} from '../store.js';
import { repoRoot, type AgentTask } from '../db.js';

export interface ActiveTask {
	id: string;
	item_id: string | null;
	proc: ChildProcess | null;
	emitter: EventEmitter;
	transcript: string;
	raw: string;
	sessionId: string | null;
	timeout: NodeJS.Timeout | null;
	exited: boolean;
	finished: boolean;
	timedOut: boolean;
}

const active = new Map<string, ActiveTask>();

// At module load the in-memory table is empty by definition, so any 'running'
// row in the DB is an orphan from a previous process. Reconcile it so the
// per-item 409 guard cannot wedge an item forever after a restart.
reconcileStaleAgentTasks();

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
// Read at module load; tests re-import the module (vi.resetModules) with a
// small override so the escalation window is testable without wall-clock races.
const KILL_ESCALATION_MS = Number(process.env.BUILDBOARD_AGENT_KILL_MS) || 5000;

function agentTimeoutMs(): number {
	const raw = process.env.BUILDBOARD_AGENT_TIMEOUT_MS;
	const n = raw ? Number(raw) : NaN;
	return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

export function agentDir(): string {
	return process.env.BUILDBOARD_AGENT_DIR ?? repoRoot();
}

export function isActive(id: string): boolean {
	return active.has(id);
}

export function getActive(id: string): ActiveTask | undefined {
	return active.get(id);
}

/**
 * Create an agent task row and spawn `opencode run --format json`.
 * Returns the created task. Events stream on the task's emitter:
 *   'chunk' (string) — new text from the agent
 *   'done'  ({status, sessionId}) — process finished
 */
export function startAgentTask(input: {
	item_id?: string | null;
	prompt: string;
	agent?: string | null;
	model?: string | null;
}): AgentTask {
	if (input.item_id) {
		if ([...active.values()].some((e) => e.item_id === input.item_id)) {
			throw new StoreError(409, 'agent task already running for this item');
		}
		if (getRunningAgentTaskForItem(input.item_id)) {
			throw new StoreError(409, 'agent task already running for this item');
		}
	}

	const task = createAgentTask(input);
	const emitter = new EventEmitter();
	const entry: ActiveTask = {
		id: task.id,
		item_id: task.item_id,
		proc: null,
		emitter,
		transcript: '',
		raw: '',
		sessionId: null,
		timeout: null,
		exited: false,
		finished: false,
		timedOut: false
	};
	active.set(task.id, entry);

	const args = ['run', '--format', 'json'];
	if (input.agent) args.push('--agent', input.agent);
	if (input.model) args.push('--model', input.model);
	args.push('--dir', agentDir(), input.prompt);

	const spawnOptions: SpawnOptions = {
		cwd: agentDir(),
		env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
		stdio: ['ignore', 'pipe', 'pipe'],
		// Own process group so a hung child and its descendants can be killed together.
		detached: true
	};
	const overrideCmd = process.env.BUILDBOARD_AGENT_CMD;
	const proc = overrideCmd
		? spawn('sh', ['-c', overrideCmd, ...args], spawnOptions)
		: spawn('opencode', args, spawnOptions);
	entry.proc = proc;

	const timeoutMs = agentTimeoutMs();
	const timeoutNote = `[timed out after ${timeoutMs}ms]`;
	entry.timeout = setTimeout(() => {
		entry.transcript += `\n\n${timeoutNote}`;
		entry.timedOut = true;
		killEscalating(entry);
	}, timeoutMs);

	let lineBuffer = '';

	const stdout = proc.stdout;
	const stderr = proc.stderr;
	if (!stdout || !stderr) {
		finalize(entry, 'failed', { error: 'agent stdio unavailable' });
		return task;
	}

	stdout.on('data', (data: Buffer) => {
		lineBuffer += data.toString('utf8');
		let idx: number;
		while ((idx = lineBuffer.indexOf('\n')) >= 0) {
			const line = lineBuffer.slice(0, idx).trim();
			lineBuffer = lineBuffer.slice(idx + 1);
			if (!line) continue;
			entry.raw += line + '\n';
			try {
				const event = JSON.parse(line) as { type?: string; sessionID?: string; part?: { type?: string; text?: string } };
				if (event.sessionID) entry.sessionId = event.sessionID;
				if (event.type === 'text' && event.part?.type === 'text' && event.part.text) {
					entry.transcript += event.part.text;
					emitter.emit('chunk', event.part.text);
				}
			} catch {
				// Non-JSON output line (e.g. a banner); keep it in raw only.
			}
		}
	});

	stderr.on('data', (data: Buffer) => {
		entry.raw += `[stderr] ${data.toString('utf8')}`;
	});

	proc.on('exit', () => {
		entry.exited = true;
	});

	proc.on('error', (err) => {
		finalize(entry, 'failed', { error: err.message });
	});

	proc.on('close', (code) => {
		entry.exited = true;
		const status = code === 0 ? 'succeeded' : 'failed';
		finalize(
			entry,
			status,
			entry.timedOut ? { code, note: timeoutNote } : { code }
		);
	});

	return task;
}

/**
 * Send SIGTERM to the child's whole process group, then SIGKILL after the
 * escalation delay (default ~5s) if any member is still alive. Both cancel and timeout go through here;
 * the `exited` flag (set from the child's exit event) plus a group-liveness
 * probe prevent signaling an already-dead process.
 */
function killEscalating(entry: ActiveTask): void {
	const proc = entry.proc;
	if (!proc) return;
	const pid = proc.pid;
	if (pid == null) return;
	const groupAlive = (): boolean => {
		try {
			process.kill(-pid, 0);
			return true;
		} catch {
			return false;
		}
	};
	if (entry.exited && !groupAlive()) return;
	try {
		process.kill(-pid, 'SIGTERM');
	} catch {
		proc.kill('SIGTERM');
	}
	setTimeout(() => {
		if (groupAlive()) {
			try {
				process.kill(-pid, 'SIGKILL');
			} catch {
				proc.kill('SIGKILL');
			}
		}
	}, KILL_ESCALATION_MS).unref();
}

/**
 * Finalize a task exactly once: persist the outcome, clear the timeout,
 * drop the in-memory entry, and emit the single 'done' event.
 */
function finalize(
	entry: ActiveTask,
	status: 'succeeded' | 'failed' | 'canceled',
	extra: Record<string, unknown> = {}
): void {
	if (entry.finished) return;
	entry.finished = true;
	if (entry.timeout) {
		clearTimeout(entry.timeout);
		entry.timeout = null;
	}
	finishAgentTask(entry.id, status, entry.transcript || entry.raw || null);
	if (entry.item_id && status === 'succeeded' && entry.transcript) {
		writeBack(entry.item_id, entry.transcript);
	}
	active.delete(entry.id);
	entry.emitter.emit('done', { status, ...extra });
}

/** Append the agent's output to the item's body so it lands on the board. */
function writeBack(item_id: string, transcript: string): void {
	try {
		const item = getItem(item_id);
		if (!item) return;
		const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
		const section = `\n\n---\n\n## Subagent output (${stamp})\n\n${transcript}\n`;
		updateItem(item_id, { body_md: item.body_md + section });
	} catch (e) {
		console.error('writeBack failed', e);
	}
}

export function cancelAgentTask(id: string): boolean {
	const entry = active.get(id);
	if (!entry) return false;
	killEscalating(entry);
	finalize(entry, 'canceled');
	return true;
}
