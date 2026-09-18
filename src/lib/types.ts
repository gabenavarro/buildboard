// Shared domain types and constants.
// MUST stay free of node: imports — this module is imported by client code.

export type ItemKind = 'note' | 'concept' | 'task' | 'plan' | 'decision' | 'agent_task' | 'text';
export type ItemStatus = 'open' | 'in_progress' | 'done' | 'blocked';
export type MessageRole = 'user' | 'agent' | 'subagent' | 'system';
export type DecisionStatus = 'active' | 'superseded';
export type AgentTaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface Board {
	id: string;
	name: string;
	created_at: string;
}

export type BoardWithCount = Board & { item_count: number };

export interface Item {
	id: string;
	kind: ItemKind;
	title: string;
	body_md: string;
	x: number;
	y: number;
	w: number | null;
	h: number | null;
	status: ItemStatus;
	tags: string[];
	parent_id: string | null;
	board_id: string;
	ref?: string | null;
	created_at: string;
	updated_at: string;
}

export interface Edge {
	id: string;
	from_id: string;
	to_id: string;
	kind: string;
	label: string;
	board_id: string;
	created_at: string;
}

export interface Thread {
	id: string;
	title: string;
	item_id: string | null;
	created_at: string;
}

export interface Message {
	id: string;
	thread_id: string;
	role: MessageRole;
	content: string;
	meta: string | null;
	created_at: string;
}

export interface Decision {
	id: string;
	item_id: string | null;
	question: string;
	options: string[];
	choice: string | null;
	rationale: string;
	status: DecisionStatus;
	ref?: string | null;
	created_at: string;
	updated_at: string;
}

export interface Concept {
	id: string;
	name: string;
	definition: string;
	details_md: string;
	source: string | null;
	item_id: string | null;
	ref?: string | null;
	created_at: string;
	updated_at: string;
}

export interface AgentTask {
	id: string;
	item_id: string | null;
	prompt: string;
	agent: string | null;
	model: string | null;
	status: AgentTaskStatus;
	session_id: string | null;
	transcript: string | null;
	started_at: string | null;
	finished_at: string | null;
	created_at: string;
}

export const ITEM_KINDS: ItemKind[] = ['note', 'concept', 'task', 'plan', 'decision', 'agent_task', 'text'];
export const ITEM_STATUSES: ItemStatus[] = ['open', 'in_progress', 'done', 'blocked'];

export interface SearchHit {
	source: 'item' | 'decision' | 'concept' | 'message';
	id: string;
	title: string;
	snippet: string;
	score: number;
	item_id: string | null;
	board_id: string | null;
}
