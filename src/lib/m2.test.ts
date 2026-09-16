import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpRoot = mkdtempSync(path.join(tmpdir(), 'buildboard-m2-'));
let dbFile: string;

beforeEach(() => {
	dbFile = path.join(tmpRoot, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
	process.env.BUILDBOARD_DB = dbFile;
	vi.resetModules();
});

afterEach(() => {
	delete process.env.BUILDBOARD_DB;
});

describe('threads & messages', () => {
	it('creates a thread for an item and posts messages', async () => {
		const { createItem, createThread, getThreadForItem, createMessage, listMessages } = await import('../lib/store.js');
		const item = createItem({ title: 'plan A' });
		const thread = createThread('Discussion', item.id);
		expect(getThreadForItem(item.id)?.id).toBe(thread.id);

		createMessage({ thread_id: thread.id, content: 'hello', role: 'user' });
		createMessage({ thread_id: thread.id, content: 'world', role: 'subagent' });
		const msgs = listMessages(thread.id);
		expect(msgs).toHaveLength(2);
		expect(msgs[0].content).toBe('hello');
		expect(msgs[1].role).toBe('subagent');
	});
});

describe('decisions', () => {
	it('records, supersedes, and lists decisions', async () => {
		const { createItem, createDecision, updateDecision, listDecisions } = await import('../lib/store.js');
		const item = createItem({ title: 'choice' });
		const d = createDecision({
			item_id: item.id,
			question: 'Which adapter?',
			options: ['node', 'static'],
			choice: 'node',
			rationale: 'we run a server'
		});
		expect(listDecisions({ item_id: item.id })).toHaveLength(1);
		const updated = updateDecision(d.id, { status: 'superseded' });
		expect(updated?.status).toBe('superseded');
		expect(listDecisions({ item_id: item.id, status: 'active' })).toHaveLength(0);
	});
});

describe('concepts', () => {
	it('creates and looks up concepts by item', async () => {
		const { createItem, createConcept, getConceptForItem, listConcepts } = await import('../lib/store.js');
		const item = createItem({ title: 'WAL' });
		const c = createConcept({ name: 'WAL', definition: 'Write-Ahead Logging', item_id: item.id });
		expect(getConceptForItem(item.id)?.id).toBe(c.id);
		expect(listConcepts()).toHaveLength(1);
	});
});

describe('search (FTS5)', () => {
	it('finds items, decisions, concepts, and messages by text', async () => {
		const {
			createItem,
			createDecision,
			createConcept,
			createThread,
			createMessage
		} = await import('../lib/store.js');
		const { search } = await import('../lib/search.js');

		createItem({ title: 'quantum entanglement protocol', body_md: 'pairs of qubits' });
		createDecision({ question: 'should we use quantum entanglement?', rationale: 'risky' });
		createConcept({ name: 'entanglement', definition: 'correlated qubits' });
		const thread = createThread('t');
		createMessage({ thread_id: thread.id, content: 'entanglement is spooky' });

		const hits = search('entanglement');
		expect(hits.length).toBeGreaterThanOrEqual(3);
		const sources = new Set(hits.map((h) => h.source));
		expect(sources.has('item')).toBe(true);
		expect(sources.has('decision')).toBe(true);
		expect(sources.has('concept')).toBe(true);
		expect(sources.has('message')).toBe(true);

		// update triggers keep the index in sync
		const { updateItem } = await import('../lib/store.js');
		const item = (await import('../lib/store.js')).listItems().find((i) => i.title.startsWith('quantum'))!;
		updateItem(item.id, { title: 'renamed thing' });
		expect(search('quantum').some((h) => h.source === 'item')).toBe(false);
	});
});

describe('brief (digest)', () => {
	it('produces a compact digest reflecting board state', async () => {
		const { createItem, createDecision, createConcept } = await import('../lib/store.js');
		const { buildBrief } = await import('../lib/digest.js');

		expect(buildBrief()).toContain('Board brief (0 items)');

		createItem({ title: 'ship it', kind: 'task', status: 'open' });
		createDecision({ question: 'Q?', choice: 'A' });
		createConcept({ name: 'C', definition: 'a definition' });

		const brief = buildBrief();
		expect(brief).toContain('ship it');
		expect(brief).toContain('Q? → A');
		expect(brief).toContain('C: a definition');
		expect(brief.length).toBeLessThan(2000);
	});
});
