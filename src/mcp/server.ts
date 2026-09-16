import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
	getItem,
	listItems,
	createItem,
	updateItem,
	moveItem,
	deleteItem,
	createEdge,
	updateEdge,
	deleteEdge,
	createDecision,
	updateDecision,
	deleteDecision,
	listDecisions,
	getThreadForItem,
	createThread,
	createMessage,
	listMessages,
	validateCreateItem,
	listConcepts,
	getConcept,
	getConceptForItem,
	listBoards,
	getBoard,
	createBoard,
	deleteBoard,
	listAgentTasks,
	getAgentTask
} from '../lib/store.js';
import { search } from '../lib/search.js';
import { buildBrief } from '../lib/digest.js';
import { startAgentTask } from '../lib/agents/runner.js';
import { buildPrompt } from '../lib/agents/prompt.js';

// Resolve the package version at runtime. In dev this file is src/mcp/server.ts
// and in the esbuild bundle it is dist/mcp/server.mjs — both are two levels
// below the repo root, so ../../package.json works from either location.
function packageVersion(): string {
	try {
		const require = createRequire(import.meta.url);
		const pkg = require('../../package.json') as { version?: unknown };
		if (typeof pkg.version === 'string') return pkg.version;
	} catch {
		// bundled build where the relative require is unavailable
	}
	return '0.0.1';
}

const server = new McpServer({
	name: 'buildboard',
	version: packageVersion()
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
			board: z.string().optional().describe('Restrict to one board'),
			limit: z.number().int().min(1).max(50).optional().describe('Max hits (default 20)')
		}
	},
	({ q, source, board, limit }) => text(search(q, { source, limit, board_id: board }))
);

server.registerTool(
	'bb_item_list',
	{
		title: 'List board items',
		description: 'List board items, optionally filtered by board, kind, status, or tag.',
		inputSchema: {
			board: z.string().optional().describe('Board to list (default: all boards)'),
			kind: z.enum(['note', 'concept', 'task', 'plan', 'decision', 'agent_task']).optional(),
			status: z.enum(['open', 'in_progress', 'done', 'blocked']).optional(),
			tag: z.string().optional()
		}
	},
	({ board, kind, status, tag }) => text(listItems({ board_id: board, kind, status, tag }))
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
			y: z.number().optional(),
			board_id: z.string().optional().describe('Board for the item (create) / move the item to this board (update)')
		}
	},
	({ id, board_id, ...rest }) => {
		if (board_id && !getBoard(board_id)) return fail(`unknown board: ${board_id}`);
		if (id) {
			let item = updateItem(id, rest);
			if (!item) return fail(`no item with id ${id}`);
			if (board_id) item = moveItem(id, board_id) ?? item;
			return text(item);
		}
		const validated = validateCreateItem({ ...rest, board_id });
		if (!validated.ok) return fail(validated.error);
		return text(createItem(validated.value));
	}
);

server.registerTool(
	'bb_item_update',
	{
		title: 'Update an item',
		description:
			'Update fields of an existing board item (title, kind, status, tags, body_md, position, and board via board_id). Only the provided fields change.',
		inputSchema: {
			item_id: z.string(),
			title: z.string().optional(),
			kind: z.enum(['note', 'concept', 'task', 'plan', 'decision', 'agent_task']).optional(),
			status: z.enum(['open', 'in_progress', 'done', 'blocked']).optional(),
			tags: z.array(z.string()).optional(),
			body_md: z.string().optional(),
			x: z.number().optional(),
			y: z.number().optional(),
			board_id: z.string().optional().describe('Move the item to this board')
		}
	},
	({ item_id, board_id, ...rest }) => {
		if (board_id && !getBoard(board_id)) return fail(`unknown board: ${board_id}`);
		let item = updateItem(item_id, rest);
		if (!item) return fail(`no item with id ${item_id}`);
		if (board_id) item = moveItem(item_id, board_id) ?? item;
		return text(item);
	}
);

server.registerTool(
	'bb_item_delete',
	{
		title: 'Delete an item',
		description:
			'Delete a board item along with its threads, messages, decisions, and agent tasks. Edges to/from it are removed; concepts survive.',
		inputSchema: { item_id: z.string() }
	},
	({ item_id }) => {
		const deleted = deleteItem(item_id);
		return deleted ? text({ deleted: item_id }) : fail(`no item with id ${item_id}`);
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
	'bb_edge_update',
	{
		title: 'Update an edge',
		description: 'Update the kind and/or label of an existing edge.',
		inputSchema: {
			edge_id: z.string(),
			kind: z.string().optional().describe('Edge kind, e.g. depends_on, relates_to, blocks'),
			label: z.string().optional()
		}
	},
	({ edge_id, kind, label }) => {
		const edge = updateEdge(edge_id, { kind, label });
		return edge ? text(edge) : fail(`no edge with id ${edge_id}`);
	}
);

server.registerTool(
	'bb_edge_delete',
	{
		title: 'Delete an edge',
		description: 'Delete an edge between two board items.',
		inputSchema: { edge_id: z.string() }
	},
	({ edge_id }) => {
		const deleted = deleteEdge(edge_id);
		return deleted ? text({ deleted: edge_id }) : fail(`no edge with id ${edge_id}`);
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
	'bb_decision_update',
	{
		title: 'Update a decision',
		description:
			'Update a recorded decision: mark it superseded, change its chosen option, or fix its rationale. Only the provided fields change.',
		inputSchema: {
			decision_id: z.string(),
			status: z.enum(['active', 'superseded']).optional(),
			choice: z.string().optional(),
			rationale: z.string().optional()
		}
	},
	({ decision_id, status, choice, rationale }) => {
		const decision = updateDecision(decision_id, { status, choice, rationale });
		return decision ? text(decision) : fail(`no decision with id ${decision_id}`);
	}
);

server.registerTool(
	'bb_decision_delete',
	{
		title: 'Delete a decision',
		description: 'Delete a recorded decision.',
		inputSchema: { decision_id: z.string() }
	},
	({ decision_id }) => {
		const deleted = deleteDecision(decision_id);
		return deleted ? text({ deleted: decision_id }) : fail(`no decision with id ${decision_id}`);
	}
);

server.registerTool(
	'bb_concept_list',
	{
		title: 'List concepts',
		description: 'List concept cards, optionally restricted to the one attached to a given item.',
		inputSchema: {
			item_id: z.string().optional().describe('Only the concept attached to this item')
		}
	},
	({ item_id }) => {
		if (item_id) {
			if (!getItem(item_id)) return fail(`no item with id ${item_id}`);
			const concept = getConceptForItem(item_id);
			return text(concept ? [concept] : []);
		}
		return text(listConcepts());
	}
);

server.registerTool(
	'bb_concept_get',
	{
		title: 'Get a concept',
		description: 'Fetch one concept card by id.',
		inputSchema: { concept_id: z.string() }
	},
	({ concept_id }) => {
		const concept = getConcept(concept_id);
		return concept ? text(concept) : fail(`no concept with id ${concept_id}`);
	}
);

server.registerTool(
	'bb_board_list',
	{
		title: 'List boards',
		description: 'List all boards (id, name, created_at, item_count).',
		inputSchema: {}
	},
	() => text(listBoards())
);

server.registerTool(
	'bb_board_create',
	{
		title: 'Create a board',
		description: 'Create a new board with a unique name.',
		inputSchema: { name: z.string() }
	},
	({ name }) => {
		try {
			return text(createBoard(name));
		} catch (e) {
			if (e instanceof Error && /board name already exists/.test(e.message)) return fail(e.message);
			throw e;
		}
	}
);

server.registerTool(
	'bb_board_delete',
	{
		title: 'Delete a board',
		description:
			'Delete a board. Fails for the default board and for any board that still has items (delete its items first).',
		inputSchema: { board_id: z.string() }
	},
	({ board_id }) => {
		if (!getBoard(board_id)) return fail(`no board with id ${board_id}`);
		const deleted = deleteBoard(board_id);
		return deleted ? text({ deleted: board_id }) : fail(`cannot delete board ${board_id} (default board or has items)`);
	}
);

server.registerTool(
	'bb_agent_task_get',
	{
		title: 'Get an agent task',
		description:
			'Fetch one agent task by id: status, item, prompt, transcript, and timestamps. Use this to poll a task started with bb_spawn_agent.',
		inputSchema: { task_id: z.string() }
	},
	({ task_id }) => {
		const task = getAgentTask(task_id);
		return task ? text(task) : fail(`no agent task with id ${task_id}`);
	}
);

server.registerTool(
	'bb_agent_tasks',
	{
		title: 'List agent tasks',
		description:
			'List agent tasks, optionally filtered by item and/or status. Use this to poll tasks started with bb_spawn_agent.',
		inputSchema: {
			item_id: z.string().optional(),
			status: z.enum(['pending', 'running', 'succeeded', 'failed', 'canceled']).optional(),
			limit: z.number().int().min(1).max(500).optional().describe('Max tasks (default 50)')
		}
	},
	({ item_id, status, limit }) => text(listAgentTasks(limit ?? 50, { item_id, status }))
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
			'Spawn an opencode subagent to expand a board item in detail. The agent streams its work and writes the result back onto the item. Returns the agent task id; poll its progress with bb_agent_task_get (or bb_agent_tasks) and read the final item with bb_item_get.',
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
		return text({
			task_id: task.id,
			status: task.status,
			note: 'running — poll bb_agent_task_get (or bb_agent_tasks) for status and transcript'
		});
	}
);

const transport = new StdioServerTransport();
await server.connect(transport);
