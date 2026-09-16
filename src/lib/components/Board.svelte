<script lang="ts">
	import { SvelteFlow, Background, MiniMap, useSvelteFlow, type Node, type Edge, type Connection } from '@xyflow/svelte';
	import { setContext } from 'svelte';

	import ItemNode from '$lib/components/ItemNode.svelte';
	import Palette from '$lib/components/Palette.svelte';
	import DetailPanel from '$lib/components/DetailPanel.svelte';
	import { api } from '$lib/api.js';
	import type { Item, ItemKind } from '$lib/db.js';

	type BoardNode = Node<{ item: Item }>;

	let { boardId, onitemchanged }: { boardId: string; onitemchanged?: () => void } = $props();

	let nodes = $state<BoardNode[]>([]);
	let edges = $state<Edge[]>([]);
	let selected = $state<Item | null>(null);
	let loaded = $state(false);
	let justCreatedId = $state<string | null>(null);
	let boardRef = $state<HTMLElement | null>(null);

	const nodeTypes = { item: ItemNode };

	const { screenToFlowPosition } = useSvelteFlow();

	setContext('board:statuschange', (item: Item) => handleUpdated(item));

	function flowContainer(): HTMLElement | null {
		return boardRef?.querySelector('.svelte-flow') ?? null;
	}

	async function load() {
		loaded = false;
		selected = null;
		try {
			const [items, edgeList] = await Promise.all([
				api.listItems({ board: boardId }),
				api.listEdges().then((all) => all.filter((e) => e.board_id === boardId))
			]);
			nodes = items.map((item) => ({
				id: item.id,
				type: 'item',
				position: { x: item.x, y: item.y },
				data: { item }
			}));
			edges = edgeList.map((e) => ({
				id: e.id,
				source: e.from_id,
				target: e.to_id,
				label: e.label || undefined
			}));
		} catch (e) {
			console.error(e);
		}
		loaded = true;
	}

	$effect(() => {
		// Runs on mount and again whenever the active board changes.
		void boardId;
		void load();
	});

	function findItem(id: string): Item | null {
		const node = nodes.find((n) => n.id === id);
		return node ? (node.data.item as Item) : null;
	}

	async function createItemAt(kind: ItemKind, client: { x: number; y: number }) {
		const pos = screenToFlowPosition(client);
		const item = await api.createItem({
			kind,
			title: `New ${kind}`,
			x: Math.round(pos.x),
			y: Math.round(pos.y),
			board_id: boardId
		});
		nodes = [
			...nodes,
			{ id: item.id, type: 'item', position: { x: item.x, y: item.y }, data: { item } }
		];
		selected = item;
		justCreatedId = item.id;
	}

	async function handleCreate(kind: ItemKind, client: { x: number; y: number }) {
		const rect = flowContainer()?.getBoundingClientRect();
		const screen = rect
			? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
			: client;
		await createItemAt(kind, screen);
	}

	function handlePaneDblClick(e: MouseEvent) {
		const target = e.target as HTMLElement | null;
		if (!target) return;
		if (target.closest('.svelte-flow__node') || target.closest('.svelte-flow__minimap')) return;
		void createItemAt('note', { x: e.clientX, y: e.clientY });
	}

	$effect(() => {
		if (!loaded) return;
		const el = flowContainer();
		if (!el) return;
		el.addEventListener('dblclick', handlePaneDblClick);
		return () => el.removeEventListener('dblclick', handlePaneDblClick);
	});

	async function handleConnect(connection: Connection) {
		try {
			const edge = await api.createEdge({
				from_id: connection.source!,
				to_id: connection.target!,
				kind: 'depends_on',
				board_id: boardId
			});
			edges = [
				...edges,
				{ id: edge.id, source: edge.from_id, target: edge.to_id, label: edge.label || undefined }
			];
		} catch (e) {
			console.error(e);
		}
	}

	function handleDragStop({ targetNode }: { targetNode: BoardNode | null }) {
		if (!targetNode) return;
		const pos = targetNode.position;
		const node = nodes.find((n) => n.id === targetNode.id);
		if (node) node.position = { x: pos.x, y: pos.y };
		api.updateItem(targetNode.id, { x: pos.x, y: pos.y }).catch((e) => console.error(e));
	}

	async function handleDelete({ nodes: removedNodes, edges: removedEdges }: { nodes: BoardNode[]; edges: Edge[] }) {
		for (const n of removedNodes) {
			await api.deleteItem(n.id).catch((e) => console.error(e));
		}
		for (const e of removedEdges) {
			await api.deleteEdge(e.id).catch((e) => console.error(e));
		}
		nodes = nodes.filter((n) => !removedNodes.some((rn) => rn.id === n.id));
		edges = edges.filter((e) => !removedEdges.some((re) => re.id === e.id));
		const sel = selected;
		if (sel && removedNodes.some((n) => n.id === sel.id)) selected = null;
	}

	function handleSelectionChange({ nodes: selNodes }: { nodes: BoardNode[] }) {
		selected = selNodes.length > 0 ? findItem(selNodes[0].id) : null;
	}

	function handlePaneClick() {
		selected = null;
	}

	function handleUpdated(item: Item) {
		const node = nodes.find((n) => n.id === item.id);
		if (node) node.data.item = item;
		selected = item;
		onitemchanged?.();
	}

	async function handleDeleted(id: string) {
		await api.deleteItem(id).catch((e) => console.error(e));
		nodes = nodes.filter((n) => n.id !== id);
		edges = edges.filter((e) => e.source !== id && e.target !== id);
		selected = null;
		onitemchanged?.();
	}

	function exportMarkdown() {
		const lines: string[] = [`# Buildboard — ${boardId}`, ''];
		for (const n of nodes) {
			const it = n.data.item as Item;
			lines.push(`## [${it.kind}] ${it.title}`);
			if (it.status) lines.push(`_status: ${it.status}_`);
			if (it.tags.length) lines.push(`_tags: ${it.tags.join(', ')}_`);
			if (it.body_md) lines.push('', it.body_md);
			lines.push('');
		}
		if (edges.length) {
			lines.push('## Edges');
			for (const e of edges) {
				const s = nodes.find((n) => n.id === e.source)?.data.item?.title ?? e.source;
				const t = nodes.find((n) => n.id === e.target)?.data.item?.title ?? e.target;
				lines.push(`- ${s} → ${t}${e.label ? ` (${e.label})` : ''}`);
			}
		}
		const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `buildboard-${boardId}.md`;
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<div class="wrap">
	<div class="board" bind:this={boardRef}>
		{#if loaded}
			<SvelteFlow
				{nodes}
				{edges}
				{nodeTypes}
				fitView
				onconnect={handleConnect}
				onnodedragstop={handleDragStop}
				ondelete={handleDelete}
				onselectionchange={handleSelectionChange}
				onpaneclick={handlePaneClick}
			>
				<Background />
				<MiniMap />
			</SvelteFlow>
		{:else}
			<div class="loading">loading board…</div>
		{/if}

		{#if loaded && nodes.length === 0}
			<div class="hint">Double-click anywhere to add a note</div>
		{/if}

		<div class="overlays">
			<Palette onCreate={handleCreate} />
		</div>
		<div class="actions">
			<button onclick={exportMarkdown} title="Export board to markdown">Export .md</button>
		</div>
	</div>

	{#if selected}
		{#key selected.id}
			<DetailPanel
				item={selected}
				autofocusTitle={selected.id === justCreatedId}
				onclose={() => {
					selected = null;
					justCreatedId = null;
				}}
				ondelete={(id) => void handleDeleted(id)}
				onupdated={handleUpdated}
			/>
		{/key}
	{/if}
</div>

<style>
	.wrap {
		display: flex;
		flex: 1;
		min-height: 0;
	}
	.board {
		flex: 1;
		min-width: 0;
		min-height: 0;
		position: relative;
	}
	.loading {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		color: var(--text-dim);
	}
	.hint {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		color: var(--text-dim);
		pointer-events: none;
		font-size: 14px;
	}
	.overlays {
		position: absolute;
		top: 10px;
		left: 10px;
		z-index: 5;
	}
	.actions {
		position: absolute;
		top: 10px;
		right: 10px;
		z-index: 5;
		display: flex;
		gap: 6px;
	}
</style>
