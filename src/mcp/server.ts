import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
	getItem,
	listItems,
	createItem,
	updateItem,
	createEdge,
	createDecision,
	listDecisions,
	getThreadForItem,
	createThread,
	createMessage,
	listMessages,
	validateCreateItem
} from '../lib/store.js';
import { search } from '../lib/search.js';
import { buildBrief } from '../lib/digest.js';
import { startAgentTask } from '../lib/agents/runner.js';
import { buildPrompt } from '../lib/agents/prompt.js';

const server = new McpServer({
	name: 'buildboard',
	version: '0.1.0'
});

function text(payload: unknown) {
	return {
		content: [{ type: 'text' as const, text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }]
	};
}

function fail(message: string) {
	return { content: [{ type: 'text' as const, text: `error: ${message}` }], isError: true };
}

function isUniqueViolation(e: unknown): boolean {
	return e instanceof Error && /UNIQUE constraint failed/i.test(e.message);
}

server.registerTool(
	'bb_brief',
	{
		title: 'Board brief',
		description:
			'Get a compact context digest of one board (~200 tokens): counts, open work, active decisions, concepts, recent messages. Defaults to the default board. Start here to orient yourself.',
		inputSchema: {
			board_id: z.string().optional().describe('Board to digest (default: the default board)')
		}
	},
	({ board_id }) => text(buildBrief({ board_id }))
);

server.registerTool(
	'bb_search',
	{
		title: 'Search the board',
		description: 'Full-text search across items, decisions, concepts, and messages. Returns ranked hits with snippets.',
		inputSchema: {
			q: z.string().describe('Search query'),
			source: z.enum(['item', 'decision', 'concept', 'message']).optional().describe('Restrict to one source type'),
			limit: z.number().int().min(1).max(50).optional().describe('Max hits (default 20)')
		}
	},
	({ q, source, limit }) => text(search(q, { source, limit }))
);

server.registerTool(
	'bb_item_list',
	{
		title: 'List board items',
		description: 'List board items, optionally filtered by kind, status, or tag.',
		inputSchema: {
			kind: z.enum(['note', 'concept', 'task', 'plan', 'decision', 'agent_task']).optional(),
			status: z.enum(['open', 'in_progress', 'done', 'blocked']).optional(),
			tag: z.string().optional()
		}
	},
	({ kind, status, tag }) => text(listItems({ kind, status, tag }))
);

server.registerTool(
	'bb_item_get',
	{
		title: 'Get an item',
		description: 'Fetch one board item by id.',
		inputSchema: { id: z.string() }
	},
	({ id }) => {
		const item = getItem(id);
		return item ? text(item) : fail(`no item with id ${id}`);
	}
);

server.registerTool(
	'bb_item_upsert',
	{
		title: 'Create or update an item',
		description:
			'Create a new board item (omit id) or update an existing one (provide id). The board is the single source of truth: planning work lands here as typed nodes.',
		inputSchema: {
			id: z.string().optional().describe('Existing item id to update; omit to create'),
			kind: z.enum(['note', 'concept', 'task', 'plan', 'decision', 'agent_task']).optional(),
			title: z.string(),
			body_md: z.string().optional(),
			status: z.enum(['open', 'in_progress', 'done', 'blocked']).optional(),
			tags: z.array(z.string()).optional(),
			parent_id: z.string().nullable().optional(),
			x: z.number().optional(),
			y: z.number().optional()
		}
	},
	({ id, ...rest }) => {
		if (id) {
			const item = updateItem(id, rest);
			return item ? text(item) : fail(`no item with id ${id}`);
		}
		const validated = validateCreateItem({ ...rest });
		if (!validated.ok) return fail(validated.error);
		return text(createItem(validated.value));
	}
);

server.registerTool(
	'bb_edge_add',
	{
		title: 'Connect two items',
		description: 'Add an edge (relationship) between two board items.',
		inputSchema: {
			from_id: z.string(),
			to_id: z.string(),
			kind: z.string().optional().describe('Edge kind, e.g. depends_on, relates_to, blocks'),
			label: z.string().optional()
		}
	},
	({ from_id, to_id, kind, label }) => {
		if (!getItem(from_id)) return fail(`no item with id ${from_id}`);
		if (!getItem(to_id)) return fail(`no item with id ${to_id}`);
		try {
			return text(createEdge({ from_id, to_id, kind, label }));
		} catch (e) {
			if (isUniqueViolation(e)) return fail('edge already exists');
			throw e;
		}
	}
);

server.registerTool(
	'bb_decision_add',
	{
		title: 'Record a decision',
		description:
			'Record a decision (question, options, chosen option, rationale) optionally attached to a board item. This is the durable memory for "we decided X".',
		inputSchema: {
			item_id: z.string().optional(),
			question: z.string(),
			options: z.array(z.string()).optional(),
			choice: z.string().optional(),
			rationale: z.string().optional()
		}
	},
	({ item_id, question, options, choice, rationale }) => {
		if (item_id && !getItem(item_id)) return fail(`no item with id ${item_id}`);
		try {
			return text(createDecision({ item_id, question, options, choice, rationale }));
		} catch (e) {
			if (isUniqueViolation(e)) return fail('decision already exists');
			throw e;
		}
	}
);

server.registerTool(
	'bb_decision_list',
	{
		title: 'List decisions',
		description: 'List recorded decisions, optionally filtered by item or status.',
		inputSchema: {
			item_id: z.string().optional(),
			status: z.enum(['active', 'superseded']).optional()
		}
	},
	({ item_id, status }) => text(listDecisions({ item_id, status }))
);

server.registerTool(
	'bb_message_add',
	{
		title: 'Post a message to an item thread',
		description:
			'Append a message to the discussion thread attached to a board item (created on demand). role: user | agent | subagent | system.',
		inputSchema: {
			item_id: z.string(),
			content: z.string(),
			role: z.enum(['user', 'agent', 'subagent', 'system']).optional()
		}
	},
	({ item_id, content, role }) => {
		const item = getItem(item_id);
		if (!item) return fail(`no item with id ${item_id}`);
		let thread = getThreadForItem(item_id);
		if (!thread) thread = createThread(`Discussion: ${item.title}`, item_id);
		return text(createMessage({ thread_id: thread.id, content, role }));
	}
);

server.registerTool(
	'bb_messages',
	{
		title: 'Read an item thread',
		description: 'Read the discussion messages attached to a board item.',
		inputSchema: {
			item_id: z.string(),
			limit: z.number().int().min(1).max(500).optional()
		}
	},
	({ item_id, limit }) => {
		const item = getItem(item_id);
		if (!item) return fail(`no item with id ${item_id}`);
		const thread = getThreadForItem(item_id);
		if (!thread) return text([]);
		return text(listMessages(thread.id, limit ?? 200));
	}
);

server.registerTool(
	'bb_spawn_agent',
	{
		title: 'Spawn a subagent on a board item',
		description:
			'Spawn an opencode subagent to expand a board item in detail. The agent streams its work and writes the result back onto the item. Returns the agent task id; poll bb_item_get or the app UI for the result.',
		inputSchema: {
			item_id: z.string(),
			agent: z.enum(['general', 'explore', 'plan', 'build']).optional().describe('Default general'),
			instruction: z.string().optional().describe('Extra instruction for the agent')
		}
	},
	({ item_id, agent, instruction }) => {
		const item = getItem(item_id);
		if (!item) return fail(`no item with id ${item_id}`);
		const task = startAgentTask({ item_id, prompt: buildPrompt(item, instruction), agent: agent ?? null });
		return text({ task_id: task.id, status: task.status, note: 'running — poll GET /api/agent-tasks/<id> in the buildboard app' });
	}
);

const transport = new StdioServerTransport();
await server.connect(transport);
