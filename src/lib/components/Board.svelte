<script lang="ts">
	import { SvelteFlow, Background, useSvelteFlow, type Node, type Edge, type Connection } from '@xyflow/svelte';

	import ItemNode from '$lib/components/ItemNode.svelte';
	import Palette from '$lib/components/Palette.svelte';
	import DetailPanel from '$lib/components/DetailPanel.svelte';
	import { api } from '$lib/api.js';
	import type { Item, ItemKind } from '$lib/db.js';

	type BoardNode = Node<{ item: Item }>;

	let nodes = $state<BoardNode[]>([]);
	let edges = $state<Edge[]>([]);
	let selected = $state<Item | null>(null);
	let loaded = $state(false);

	const nodeTypes = { item: ItemNode };

	const { screenToFlowPosition } = useSvelteFlow();

	async function load() {
		try {
			const [items, edgeList] = await Promise.all([api.listItems(), api.listEdges()]);
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

	void load();

	function findItem(id: string): Item | null {
		const node = nodes.find((n) => n.id === id);
		return node ? (node.data.item as Item) : null;
	}

	async function handleCreate(kind: ItemKind, client: { x: number; y: number }) {
		const pos = screenToFlowPosition(client);
		const item = await api.createItem({
			kind,
			title: `New ${kind}`,
			x: Math.round(pos.x + Math.random() * 40 - 20),
			y: Math.round(pos.y + Math.random() * 40 - 20)
		});
		nodes = [
			...nodes,
			{ id: item.id, type: 'item', position: { x: item.x, y: item.y }, data: { item } }
		];
		selected = item;
	}

	async function handleConnect(connection: Connection) {
		try {
			const edge = await api.createEdge({
				from_id: connection.source!,
				to_id: connection.target!,
				kind: 'depends_on'
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
	}

	async function handleDeleted(id: string) {
		await api.deleteItem(id).catch((e) => console.error(e));
		nodes = nodes.filter((n) => n.id !== id);
		edges = edges.filter((e) => e.source !== id && e.target !== id);
		selected = null;
	}
</script>

<div class="wrap">
	<div class="board">
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
			</SvelteFlow>
		{:else}
			<div class="loading">loading board…</div>
		{/if}

		<div class="overlays">
			<Palette onCreate={handleCreate} />
		</div>
	</div>

	{#if selected}
		{#key selected.id}
			<DetailPanel
				item={selected}
				onclose={() => (selected = null)}
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
	.overlays {
		position: absolute;
		top: 10px;
		left: 10px;
		z-index: 5;
	}
</style>
