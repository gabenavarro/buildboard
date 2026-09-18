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
	duplicateItem,
	deleteItem,
	createEdge,
	listEdges,
	updateEdge,
	deleteEdge,
	createDecision,
	updateDecision,
	deleteDecision,
	listDecisions,
	getDecision,
	recordDecision,
	resolveDecision,
	getThreadForItem,
	createThread,
	createMessage,
	listMessages,
	validateCreateItem,
	listConcepts,
	getConcept,
	getConceptForItem,
	upsertConceptByName,
	updateConcept,
	deleteConcept,
	listBoards,
	getBoard,
	createBoard,
	renameBoard,
	deleteBoard,
	listAgentTasks,
	getAgentTask,
	StoreError
} from '../lib/store.js';
import { search } from '../lib/search.js';
import { buildBrief } from '../lib/digest.js';
import { startAgentTask, cancelAgentTask } from '../lib/agents/runner.js';
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

/**
 * One place for tool error mapping: StoreError (the store's typed
 * HTTP-ish errors) and SQLite UNIQUE violations become friendly tool
 * errors; anything else is a real bug and is rethrown.
 */
function run<T>(fn: () => T) {
	try {
		return text(fn());
	} catch (e) {
		if (e instanceof StoreError) return fail(e.message);
		if (e instanceof Error && /UNIQUE constraint failed/i.test(e.message)) return fail('duplicate: unique constraint violated');
		throw e;
	}
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
	'bb_item_duplicate',
	{
		title: 'Duplicate an item',
		description:
			'Copy a board item (same kind/title/body/position) onto the same board, or to another board. Returns the new item.',
		inputSchema: {
			item_id: z.string(),
			board_id: z.string().optional().describe('Target board (default: the source item\'s board)'),
			title_suffix: z.string().optional().describe('Appended to the copy\'s title, e.g. " (copy)"')
		}
	},
	({ item_id, board_id, title_suffix }) => {
		if (!getItem(item_id)) return fail(`no item with id ${item_id}`);
		if (board_id && !getBoard(board_id)) return fail(`unknown board: ${board_id}`);
		return run(() => duplicateItem(item_id, { board_id, title_suffix }));
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
		return run(() => createEdge({ from_id, to_id, kind, label }));
	}
);

server.registerTool(
	'bb_edge_list',
	{
		title: 'List edges',
		description: 'List board edges (relationships), optionally restricted to one board.',
		inputSchema: { board: z.string().optional().describe('Only edges on this board') }
	},
	({ board }) => text(listEdges(board))
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
	'bb_decide',
	{
		title: 'Propose a decision',
		description:
			'Propose a decision: creates the decision item + decision record + seeded thread under one short ref, so it is addressable from chat, the board, and any agent. Answer it later with bb_decision_resolve.',
		inputSchema: {
			question: z.string(),
			options: z.array(z.string()).optional(),
			why: z.string().optional(),
			rec: z.string().optional().describe('Recommended option'),
			board: z.string().optional().describe('Board for the decision item (default: the default board)')
		}
	},
	({ question, options, why, rec, board }) =>
		run(() => recordDecision({ question, options, why, rec, board_id: board }))
);

server.registerTool(
	'bb_decision_resolve',
	{
		title: 'Resolve a decision',
		description:
			'Answer a decision by ref: sets the choice, posts the answer to the decision thread, marks the decision item done, and unblocks any items blocked on it. Idempotent for the same choice.',
		inputSchema: {
			ref: z.string().describe('Decision ref (or the ref of its decision item)'),
			choice: z.string().describe(
				'Chosen option: option text, an option index (e.g. "2"), or free text when there are no options'
			),
			rationale: z.string().optional()
		}
	},
	({ ref, choice, rationale }) => run(() => resolveDecision(ref, choice, rationale))
);

server.registerTool(
	'bb_decision_get',
	{
		title: 'Get a decision',
		description: 'Fetch one decision by ref (or id).',
		inputSchema: {
			ref: z.string().describe('Decision ref (or decision id)')
		}
	},
	({ ref }) => {
		const decision = getDecision(ref);
		return decision ? text(decision) : fail(`no decision with ref ${ref}`);
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
		return run(() => createDecision({ item_id, question, options, choice, rationale }));
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
			decision_id: z.string().optional().describe('Decision id; omit when ref is given'),
			ref: z.string().optional().describe('Decision ref; resolved to an id first'),
			status: z.enum(['active', 'superseded']).optional(),
			choice: z.string().optional(),
			rationale: z.string().optional()
		}
	},
	({ decision_id, ref, status, choice, rationale }) => {
		let id = decision_id;
		if (!id) {
			if (!ref) return fail('decision_id or ref is required');
			const decision = getDecision(ref);
			if (!decision) return fail(`no decision with ref ${ref}`);
			id = decision.id;
		}
		const decision = updateDecision(id, { status, choice, rationale });
		return decision ? text(decision) : fail(`no decision with id ${id}`);
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
	'bb_concept_add',
	{
		title: 'Create or update a concept',
		description:
			'Create a concept card (name, definition, optional details/source) optionally attached to a board item. Idempotent by name: re-adding an existing term updates its definition/details instead of duplicating.',
		inputSchema: {
			name: z.string(),
			definition: z.string().optional(),
			details_md: z.string().optional(),
			source: z.string().optional(),
			item_id: z.string().optional().describe('Attach to this board item')
		}
	},
	({ name, definition, details_md, source, item_id }) => {
		if (item_id && !getItem(item_id)) return fail(`no item with id ${item_id}`);
		return run(() => upsertConceptByName(name, { definition, details_md, source, item_id }));
	}
);

server.registerTool(
	'bb_concept_update',
	{
		title: 'Update a concept',
		description: 'Update a concept card\'s name, definition, details, or source. Only the provided fields change.',
		inputSchema: {
			concept_id: z.string(),
			name: z.string().optional(),
			definition: z.string().optional(),
			details_md: z.string().optional(),
			source: z.string().optional()
		}
	},
	({ concept_id, name, definition, details_md, source }) => {
		const patch: Record<string, unknown> = {};
		if (name !== undefined) patch.name = name;
		if (definition !== undefined) patch.definition = definition;
		if (details_md !== undefined) patch.details_md = details_md;
		if (source !== undefined) patch.source = source;
		const updated = getConcept(concept_id) ? run(() => updateConcept(concept_id, patch)) : fail(`no concept with id ${concept_id}`);
		return updated;
	}
);

server.registerTool(
	'bb_concept_delete',
	{
		title: 'Delete a concept',
		description: 'Delete a concept card.',
		inputSchema: { concept_id: z.string() }
	},
	({ concept_id }) => {
		const deleted = deleteConcept(concept_id);
		return deleted ? text({ deleted: concept_id }) : fail(`no concept with id ${concept_id}`);
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
	({ name }) => run(() => createBoard(name))
);

server.registerTool(
	'bb_board_rename',
	{
		title: 'Rename a board',
		description: 'Rename a board. The name must be unique.',
		inputSchema: { board_id: z.string(), name: z.string() }
	},
	({ board_id, name }) => {
		if (!getBoard(board_id)) return fail(`no board with id ${board_id}`);
		const board = renameBoard(board_id, name);
		return board ? text(board) : fail(`cannot rename board ${board_id} (invalid or duplicate name)`);
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
	'bb_cancel_agent',
	{
		title: 'Cancel a running agent task',
		description:
			'Cancel a running agent task (SIGTERM, escalating to SIGKILL). The task is marked canceled; the item is unblocked for a new spawn.',
		inputSchema: { task_id: z.string() }
	},
	({ task_id }) => {
		if (!getAgentTask(task_id)) return fail(`no agent task with id ${task_id}`);
		const canceled = cancelAgentTask(task_id);
		return canceled ? text({ canceled: task_id }) : fail(`agent task ${task_id} is not running`);
	}
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
