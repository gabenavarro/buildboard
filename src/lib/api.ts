import type { Item, Edge, ItemKind, ItemStatus } from './db.js';

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

	listEdges: () => request<Edge[]>('/api/edges'),
	createEdge: (input: { from_id: string; to_id: string; kind?: string; label?: string }) =>
		request<Edge>('/api/edges', { method: 'POST', body: JSON.stringify(input) }),
	deleteEdge: (id: string) => request<{ ok: boolean }>(`/api/edges/${id}`, { method: 'DELETE' })
};

export type { Item, Edge, ItemKind, ItemStatus };
