<script lang="ts">
	import { SvelteFlow, Background, BackgroundVariant, MiniMap, Controls, MarkerType, useSvelteFlow, type Node, type Edge, type Connection } from '@xyflow/svelte';
	import { setContext } from 'svelte';

	import ItemNode from '$lib/components/ItemNode.svelte';
	import Palette from '$lib/components/Palette.svelte';
	import DetailPanel from '$lib/components/DetailPanel.svelte';
	import ContextMenu from '$lib/components/ContextMenu.svelte';
	import { api } from '$lib/api.js';
	import { toast } from '$lib/toast.js';
	import type { Item, ItemKind, BoardWithCount } from '$lib/types.js';

	type BoardNode = Node<{ item: Item; i: number }>;

	let {
		boardId,
		boards = [],
		focusItem = null,
		onfocusconsumed,
		onitemchanged,
		actions
	}: {
		boardId: string;
		boards?: BoardWithCount[];
		focusItem?: string | null;
		onfocusconsumed?: () => void;
		onitemchanged?: () => void;
		actions: { fitView?: () => void; export?: () => void; create?: (kind: ItemKind) => void };
	} = $props();

	$effect(() => {
		actions.fitView = () => void fitView();
		actions.export = () => exportMarkdown();
		actions.create = (kind: ItemKind) => void handleCreate(kind, { x: 0, y: 0 });
	});

	let nodes = $state<BoardNode[]>([]);
	let edges = $state<Edge[]>([]);
	let selected = $state<Item | null>(null);
	let selectedNodes = $state<BoardNode[]>([]);
	let selectedEdges = $state<Edge[]>([]);
	let loaded = $state(false);
	let switching = $state(false);
	let justCreatedId = $state<string | null>(null);
	let boardRef = $state<HTMLElement | null>(null);

	const nodeTypes = { item: ItemNode };

	const { screenToFlowPosition, fitView, setZoom, setCenter, getZoom } = useSvelteFlow();

	let zoomPct = $state(100);
	let ctxMenu = $state<{ x: number; y: number; item: Item } | null>(null);

	function syncZoom() {
		zoomPct = Math.round(getZoom() * 100);
	}

	setContext('board:statuschange', (item: Item) => handleUpdated(item));

	function flowContainer(): HTMLElement | null {
		return boardRef?.querySelector('.svelte-flow') ?? null;
	}

	async function load(isFirst: boolean) {
		const isSwitch = !isFirst;
		loaded = false;
		if (isSwitch) switching = true;
		selected = null;
		selectedNodes = [];
		selectedEdges = [];
		try {
			const [items, edgeList] = await Promise.all([
				api.listItems({ board: boardId }),
				api.listEdges().then((all) => all.filter((e) => e.board_id === boardId))
			]);
			nodes = items.map((item, i) => ({
				id: item.id,
				type: 'item',
				position: { x: item.x, y: item.y },
				data: { item, i }
			}));
			edges = edgeList.map((e) => ({
				id: e.id,
				source: e.from_id,
				target: e.to_id,
				label: e.label || undefined,
				markerEnd: { type: MarkerType.ArrowClosed, color: 'rgba(143,160,189,0.55)', width: 16, height: 16 }
			}));
		} catch (e) {
			console.error(e);
		}
		loaded = true;
		if (isSwitch) {
			await fitView({ duration: 300 }).catch(() => false);
			switching = false;
		}
		requestAnimationFrame(syncZoom);
	}

	let firstLoad = true;

	$effect(() => {
		// Runs on mount and again whenever the active board changes.
		// firstLoad is a plain (untracked) variable so the effect never
		// depends on the loaded state - load() writes it.
		void boardId;
		void load(firstLoad);
		firstLoad = false;
	});

	// Center + select a node the parent asked us to focus (e.g. from search).
	$effect(() => {
		if (!loaded || !focusItem) return;
		const node = nodes.find((n) => n.id === focusItem);
		if (node) {
			selected = findItem(focusItem);
			void setCenter(node.position.x + 100, node.position.y + 40, { zoom: 1, duration: 300 });
		}
		onfocusconsumed?.();
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
			{ id: item.id, type: 'item', position: { x: item.x, y: item.y }, data: { item, i: nodes.length } }
		];
		selected = item;
		justCreatedId = item.id;
		toast('success', `${item.kind} added`);
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

	function handleNodeContextMenu(e: MouseEvent) {
		const target = e.target as HTMLElement | null;
		const nodeEl = target?.closest?.('.svelte-flow__node');
		if (!nodeEl) return;
		e.preventDefault();
		const id = nodeEl.getAttribute('data-id');
		const item = id ? findItem(id) : null;
		if (!item) return;
		ctxMenu = { x: e.clientX, y: e.clientY, item };
	}

	async function handleMoveNode(item: Item, targetBoardId: string) {
		try {
			await api.moveItem(item.id, targetBoardId);
			if (targetBoardId !== boardId) {
				// item left the current board — drop the node
				nodes = nodes.filter((n) => n.id !== item.id);
				if (selected?.id === item.id) selected = null;
				const dest = boards.find((b) => b.id === targetBoardId)?.name ?? 'another board';
				toast('success', `Moved to “${dest}”`);
			}
			onitemchanged?.();
		} catch (e) {
			toast('error', e instanceof Error ? e.message : 'move failed');
		}
	}

	async function handleDuplicateNode(item: Item, targetBoardId?: string) {
		try {
			const copy = await api.duplicateItem(item.id, targetBoardId ? { board_id: targetBoardId } : undefined);
			if (copy.board_id === boardId) {
				nodes = [
					...nodes,
					{ id: copy.id, type: 'item', position: { x: copy.x, y: copy.y }, data: { item: copy, i: nodes.length } }
				];
			}
			toast('success', 'Duplicated');
			onitemchanged?.();
		} catch (e) {
			toast('error', e instanceof Error ? e.message : 'duplicate failed');
		}
	}

	$effect(() => {
		if (!loaded) return;
		const el = flowContainer();
		if (!el) return;
		el.addEventListener('dblclick', handlePaneDblClick);
		el.addEventListener('contextmenu', handleNodeContextMenu);
		return () => {
			el.removeEventListener('dblclick', handlePaneDblClick);
			el.removeEventListener('contextmenu', handleNodeContextMenu);
		};
	});

	$effect(() => {
		function handleKeydown(e: KeyboardEvent) {
			if (!loaded) return;
			const ae = document.activeElement;
			if (
				ae &&
				(ae instanceof HTMLInputElement ||
					ae instanceof HTMLTextAreaElement ||
					ae instanceof HTMLSelectElement ||
					(ae as HTMLElement).isContentEditable)
			) {
				return;
			}
			if (e.key === 'Delete' || e.key === 'Backspace') {
				if (selectedNodes.length > 0 || selectedEdges.length > 0) {
					e.preventDefault();
					void handleDelete({ nodes: selectedNodes, edges: selectedEdges });
				}
			} else if (e.key === 'f' || e.key === 'F') {
				e.preventDefault();
				void fitView();
			} else if (e.key === '0') {
				e.preventDefault();
				void setZoom(1);
			} else if (e.key === 'Escape') {
				selected = null;
			}
		}
		window.addEventListener('keydown', handleKeydown);
		return () => window.removeEventListener('keydown', handleKeydown);
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
				{
					id: edge.id,
					source: edge.from_id,
					target: edge.to_id,
					label: edge.label || undefined,
					markerEnd: { type: MarkerType.ArrowClosed, color: 'rgba(143,160,189,0.55)', width: 16, height: 16 }
				}
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

	function handleSelectionChange({ nodes: selNodes, edges: selEdges }: { nodes: BoardNode[]; edges: Edge[] }) {
		selectedNodes = selNodes;
		selectedEdges = selEdges;
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
		edges = edges.filter((e) => e.source !== id || e.target !== id);
		selected = null;
		toast('success', 'Item deleted');
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
		<SvelteFlow
				class="canvas{switching ? ' faded' : ''}"
				{nodes}
				{edges}
				{nodeTypes}
				fitView
				onconnect={handleConnect}
				onnodedragstop={handleDragStop}
				ondelete={handleDelete}
				onselectionchange={handleSelectionChange}
				onpaneclick={handlePaneClick}
				onmoveend={syncZoom}
			>
				<Background variant={BackgroundVariant.Dots} gap={24} size={1.5} patternColor="rgba(143,160,189,0.14)" />
				<MiniMap maskColor="rgba(10,13,20,0.72)" nodeColor="rgba(91,140,255,0.45)" />
				<Controls position="bottom-left" showZoom showFitView />
		</SvelteFlow>

		{#if !loaded}
			<div class="loading">loading board…</div>
		{/if}

		<div class="zoomreadout" title="Zoom level (0 for 100%, f to fit)">
			{zoomPct}%
		</div>

		{#if loaded && nodes.length === 0}
			<div class="hint empty">
				<div class="empty-card">
					<span class="empty-glyph">◆</span>
					<h2>This board is empty</h2>
					<p>Double-click the canvas, or start with a note.</p>
					<button onclick={() => handleCreate('note', { x: 0, y: 0 })}>Add first note</button>
				</div>
			</div>
		{/if}

		<div class="overlays">
			<Palette onCreate={handleCreate} />
		</div>
		<div class="actions">
			<button onclick={exportMarkdown} title="Export board to markdown">Export .md</button>
		</div>
	</div>

	{#if ctxMenu}
		{@const menu = ctxMenu}
		<ContextMenu
			x={menu.x}
			y={menu.y}
			item={menu.item}
			{boards}
			onclose={() => (ctxMenu = null)}
			onmove={(it, b) => void handleMoveNode(it, b)}
			onduplicate={(it, b) => void handleDuplicateNode(it, b)}
		/>
	{/if}

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
	.board::before {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		background:
			radial-gradient(600px 340px at 18% 0%, var(--accent-soft), transparent 70%),
			radial-gradient(700px 420px at 92% 100%, rgba(176, 124, 255, 0.07), transparent 70%);
	}
	.loading {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		color: var(--text-dim);
	}
	.zoomreadout {
		position: absolute;
		left: 44px;
		bottom: 12px;
		z-index: 5;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		color: var(--text-dim);
		background: var(--glass);
		backdrop-filter: var(--glass-blur);
		-webkit-backdrop-filter: var(--glass-blur);
		border: 1px solid var(--border-soft);
		border-radius: 999px;
		padding: 3px 10px;
		box-shadow: var(--shadow-1);
	}
	.empty {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		pointer-events: none;
		z-index: 4;
	}
	.empty-card {
		pointer-events: auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 28px 36px;
		background: var(--glass);
		backdrop-filter: var(--glass-blur);
		-webkit-backdrop-filter: var(--glass-blur);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-2);
		text-align: center;
	}
	.empty-glyph {
		color: var(--accent);
		font-size: 22px;
		text-shadow: 0 0 18px var(--accent-glow);
	}
	.empty-card h2 {
		margin: 4px 0 0;
		font-family: var(--font-display);
		font-size: 16px;
		font-weight: 600;
	}
	.empty-card p {
		margin: 0 0 8px;
		font-size: 13px;
		color: var(--text-dim);
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
