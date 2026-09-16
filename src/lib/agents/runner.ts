import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { createAgentTask, finishAgentTask, updateItem, getAgentTask, getItem } from '../store.js';
import { repoRoot, type AgentTask } from '../db.js';

export interface ActiveTask {
	id: string;
	proc: ChildProcess | null;
	emitter: EventEmitter;
	transcript: string;
	raw: string;
	sessionId: string | null;
}

const active = new Map<string, ActiveTask>();

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
	const task = createAgentTask(input);
	const emitter = new EventEmitter();
	const entry: ActiveTask = {
		id: task.id,
		proc: null,
		emitter,
		transcript: '',
		raw: '',
		sessionId: null
	};
	active.set(task.id, entry);

	const args = ['run', '--format', 'json'];
	if (input.agent) args.push('--agent', input.agent);
	if (input.model) args.push('--model', input.model);
	args.push('--dir', agentDir(), input.prompt);

	const proc = spawn('opencode', args, {
		cwd: agentDir(),
		env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	entry.proc = proc;

	let lineBuffer = '';

	proc.stdout.on('data', (data: Buffer) => {
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

	proc.stderr.on('data', (data: Buffer) => {
		entry.raw += `[stderr] ${data.toString('utf8')}`;
	});

	proc.on('error', (err) => {
		finishTask(entry, task.item_id, 'failed');
		emitter.emit('done', { status: 'failed', error: err.message });
	});

	proc.on('close', (code) => {
		finishTask(entry, task.item_id, code === 0 ? 'succeeded' : 'failed');
		emitter.emit('done', { status: code === 0 ? 'succeeded' : 'failed', code });
	});

	return task;
}

function finishTask(entry: ActiveTask, item_id: string | null, status: 'succeeded' | 'failed' | 'canceled'): void {
	finishAgentTask(entry.id, status, entry.transcript || entry.raw || null);
	if (item_id && status === 'succeeded' && entry.transcript) {
		writeBack(item_id, entry.transcript);
	}
	active.delete(entry.id);
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
	entry.proc?.kill('SIGTERM');
	finishTask(entry, getAgentTask(id)?.item_id ?? null, 'canceled');
	entry.emitter.emit('done', { status: 'canceled' });
	return true;
}
