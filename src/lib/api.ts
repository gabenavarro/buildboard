import type {
	SearchHit,
	Item,
	Edge,
	ItemKind,
	ItemStatus,
	Thread,
	Message,
	Decision,
	Concept,
	AgentTask,
	Board,
	BoardWithCount
} from './types.js';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, {
		headers: { 'Content-Type': 'application/json' },
		...init
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(body.error ?? `Request failed: ${res.status}`);
	}
	return res.json() as Promise<T>;
}

export const api = {
	listItems: (query?: Record<string, string>) => {
		const qs = query ? `?${new URLSearchParams(query)}` : '';
		return request<Item[]>(`/api/items${qs}`);
	},
	getItem: (id: string) => request<Item>(`/api/items/${id}`),
	createItem: (input: Partial<Item> & { title: string }) =>
		request<Item>('/api/items', { method: 'POST', body: JSON.stringify(input) }),
	updateItem: (id: string, patch: Partial<Item>) =>
		request<Item>(`/api/items/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
	deleteItem: (id: string) => request<{ ok: boolean }>(`/api/items/${id}`, { method: 'DELETE' }),
	moveItem: (id: string, board_id: string) =>
		request<Item>(`/api/items/${id}/move`, { method: 'POST', body: JSON.stringify({ board_id }) }),
	duplicateItem: (id: string, opts?: { board_id?: string; title_suffix?: string }) =>
		request<Item>(`/api/items/${id}/duplicate`, {
			method: 'POST',
			body: JSON.stringify(opts ?? {})
		}),

	getBrief: (board?: string, tokens?: number) => {
		const params = new URLSearchParams();
		if (board) params.set('board', board);
		if (tokens !== undefined) params.set('tokens', String(tokens));
		const qs = params.toString() ? `?${params.toString()}` : '';
		return request<{ brief: string; chars: number; approx_tokens: number }>(`/api/brief${qs}`);
	},

	listEdges: () => request<Edge[]>('/api/edges'),
	getEdge: (id: string) => request<Edge>(`/api/edges/${id}`),
	createEdge: (input: { from_id: string; to_id: string; kind?: string; label?: string; board_id?: string }) =>
		request<Edge>('/api/edges', { method: 'POST', body: JSON.stringify(input) }),
	updateEdge: (id: string, patch: { kind?: string; label?: string; from_id?: string; to_id?: string }) =>
		request<Edge>(`/api/edges/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
	deleteEdge: (id: string) => request<{ ok: boolean }>(`/api/edges/${id}`, { method: 'DELETE' }),

	listThreads: (item_id?: string) =>
		request<Thread[]>(`/api/threads${item_id ? `?item_id=${item_id}` : ''}`),
	createThread: (input: { title: string; item_id?: string | null }) =>
		request<Thread>('/api/threads', { method: 'POST', body: JSON.stringify(input) }),
	deleteThread: (id: string) => request<{ ok: boolean }>(`/api/threads/${id}`, { method: 'DELETE' }),
	listMessages: (thread_id: string) => request<Message[]>(`/api/threads/${thread_id}/messages`),
	createMessage: (thread_id: string, content: string, role?: 'user' | 'agent' | 'subagent' | 'system') =>
		request<Message>(`/api/threads/${thread_id}/messages`, {
			method: 'POST',
			body: JSON.stringify({ content, role })
		}),
	deleteMessage: (thread_id: string, mid: string) =>
		request<{ ok: boolean }>(`/api/threads/${thread_id}/messages/${mid}`, { method: 'DELETE' }),

	listDecisions: (item_id?: string) =>
		request<Decision[]>(`/api/decisions${item_id ? `?item_id=${item_id}` : ''}`),
	createDecision: (input: {
		item_id?: string | null;
		question: string;
		options?: string[];
		choice?: string | null;
		rationale?: string;
	}) => request<Decision>('/api/decisions', { method: 'POST', body: JSON.stringify(input) }),
	updateDecision: (id: string, patch: Partial<Decision>) =>
		request<Decision>(`/api/decisions/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
	deleteDecision: (id: string) => request<{ ok: boolean }>(`/api/decisions/${id}`, { method: 'DELETE' }),

	listConcepts: () => request<Concept[]>('/api/concepts'),
	createConcept: (input: {
		name: string;
		definition?: string;
		details_md?: string;
		source?: string | null;
		item_id?: string | null;
	}) => request<Concept>('/api/concepts', { method: 'POST', body: JSON.stringify(input) }),
	updateConcept: (id: string, patch: Partial<Concept>) =>
		request<Concept>(`/api/concepts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
	deleteConcept: (id: string) => request<{ ok: boolean }>(`/api/concepts/${id}`, { method: 'DELETE' }),

	listAgentTasks: (limit = 50) => request<AgentTask[]>(`/api/agent-tasks?limit=${limit}`),
	getAgentTask: (id: string) => request<AgentTask>(`/api/agent-tasks/${id}`),
	createAgentTask: (input: {
		item_id?: string | null;
		prompt?: string;
		agent?: string;
		model?: string;
		instruction?: string;
	}) =>
		request<AgentTask>('/api/agent-tasks', { method: 'POST', body: JSON.stringify(input) }),
	cancelAgentTask: (id: string) => request<{ ok: boolean }>(`/api/agent-tasks/${id}`, { method: 'POST' }),

	search: (q: string, board?: string) => {
		const params = new URLSearchParams({ q });
		if (board) params.set('board', board);
		return request<{ query: string; count: number; hits: SearchHit[] }>(`/api/search?${params.toString()}`);
	},

	listBoards: () => request<BoardWithCount[]>('/api/boards'),
	createBoard: (name: string) =>
		request<Board>('/api/boards', { method: 'POST', body: JSON.stringify({ name }) }),
	renameBoard: (id: string, name: string) =>
		request<Board>(`/api/boards/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
	deleteBoard: (id: string) => request<{ ok: boolean }>(`/api/boards/${id}`, { method: 'DELETE' })
};

export type {
	Item,
	Edge,
	ItemKind,
	ItemStatus,
	Thread,
	Message,
	Decision,
	Concept,
	AgentTask,
	Board,
	BoardWithCount,
	SearchHit
};
