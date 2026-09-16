import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpRoot = mkdtempSync(path.join(tmpdir(), 'buildboard-m3-'));
let dbFile: string;

beforeEach(() => {
	dbFile = path.join(tmpRoot, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
	process.env.BUILDBOARD_DB = dbFile;
	vi.resetModules();
});

afterEach(() => {
	delete process.env.BUILDBOARD_DB;
});

describe('agent task store', () => {
	it('creates a task as running and finishes it with a transcript', async () => {
		const { createAgentTask, getAgentTask, finishAgentTask, listAgentTasks } = await import('../lib/store.js');
		const task = createAgentTask({ prompt: 'expand this', agent: 'general' });
		expect(task.status).toBe('running');
		expect(task.agent).toBe('general');
		expect(getAgentTask(task.id)?.id).toBe(task.id);

		finishAgentTask(task.id, 'succeeded', '## Result\ndone');
		const finished = getAgentTask(task.id);
		expect(finished?.status).toBe('succeeded');
		expect(finished?.transcript).toBe('## Result\ndone');
		expect(finished?.finished_at).toBeTruthy();
		expect(listAgentTasks()).toHaveLength(1);
	});
});

describe('prompt builder', () => {
	it('assembles a prompt from the item, parent, concept, and brief', async () => {
		const { createItem, createConcept } = await import('../lib/store.js');
		const { buildPrompt } = await import('../lib/agents/prompt.js');

		const parent = createItem({ title: 'Parent plan', kind: 'plan', body_md: 'the big plan' });
		const child = createItem({
			title: 'WAL concept',
			kind: 'concept',
			parent_id: parent.id,
			tags: ['storage'],
			body_md: 'partial notes'
		});
		createConcept({ name: 'WAL', definition: 'Write-Ahead Logging', item_id: child.id });

		const prompt = buildPrompt(child, 'focus on crash recovery');
		expect(prompt).toContain('WAL concept');
		expect(prompt).toContain('Parent plan');
		expect(prompt).toContain('Board context');
		expect(prompt).toContain('Write-Ahead Logging');
		expect(prompt).toContain('focus on crash recovery');
		expect(prompt).toContain('## Output');
	});

	it('handles items without a parent', async () => {
		const { createItem } = await import('../lib/store.js');
		const { buildPrompt } = await import('../lib/agents/prompt.js');
		const item = createItem({ title: 'standalone' });
		const prompt = buildPrompt(item);
		expect(prompt).toContain('(none — this item has no parent)');
	});
});
