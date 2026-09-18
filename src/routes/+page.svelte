<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { SvelteFlowProvider } from '@xyflow/svelte';

	import Board from '$lib/components/Board.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { api } from '$lib/api.js';
	import { toast } from '$lib/toast.js';
	import { theme, toggleTheme } from '$lib/theme.js';
	import type { BoardWithCount, ItemKind, SearchHit } from '$lib/types.js';

	const BOARD_KEY = 'buildboard:board';

	let boards = $state<BoardWithCount[]>([]);
	let currentBoardId = $state('default');
	const boardActions = { fitView: undefined as (() => void) | undefined, export: undefined as (() => void) | undefined, create: undefined as ((k: ItemKind) => void) | undefined };

	let renaming = $state(false);
	let focusItem = $state<string | null>(null);
	let renameName = $state('');
	let renameInput = $state<HTMLInputElement | null>(null);
	let modal = $state<'create' | 'delete' | null>(null);
	let newName = $state('');
	let modalError = $state<string | null>(null);
	let newInput = $state<HTMLInputElement | null>(null);

	$effect(() => {
		localStorage.setItem(BOARD_KEY, currentBoardId);
	});

	async function loadBoards() {
		boards = await api.listBoards();
	}

	onMount(async () => {
		try {
			boards = await api.listBoards();
			const sp = $page.url.searchParams;
			const boardParam = sp.get('board');
			const stored = localStorage.getItem(BOARD_KEY);
			currentBoardId =
				boardParam && boards.some((b) => b.id === boardParam)
					? boardParam
					: stored && boards.some((b) => b.id === stored)
						? stored
						: 'default';
			const itemParam = sp.get('item');
			if (itemParam) {
				const resolved = await api.ref(itemParam).catch(() => null);
				if (resolved) {
					if (resolved.board_id) currentBoardId = resolved.board_id;
					focusItem = resolved.id;
				} else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemParam)) {
					focusItem = itemParam;
				}
			}
		} catch (e) {
			console.error(e);
		}
	});

	async function newBoard() {
		newName = '';
		modalError = null;
		modal = 'create';
	}

	$effect(() => {
		if (modal === 'create' && newInput) newInput.focus();
	});

	async function commitNewBoard() {
		const name = newName.trim();
		if (!name) return;
		try {
			const b = await api.createBoard(name);
			currentBoardId = b.id;
			await loadBoards();
			modal = null;
			toast('success', `Board “${name}” created`);
		} catch (e) {
			modalError = e instanceof Error ? e.message : 'failed to create board';
		}
	}

	async function removeBoard(id: string) {
		if (id === 'default') return;
		modalError = null;
		modal = 'delete';
	}

	async function commitDelete() {
		const id = currentBoardId;
		try {
			await api.deleteBoard(id);
			const deleted = boards.find((b) => b.id === id)?.name ?? 'Board';
			if (currentBoardId === id) currentBoardId = 'default';
			await loadBoards();
			modal = null;
			toast('success', `Board “${deleted}” deleted`);
		} catch (e) {
			modalError = e instanceof Error ? e.message : 'failed to delete board';
		}
	}

	function handleSearchSelect(hit: SearchHit) {
		const itemId = hit.source === 'item' ? hit.id : hit.item_id;
		if (!itemId) return;
		if (hit.board_id && hit.board_id !== currentBoardId) currentBoardId = hit.board_id;
		focusItem = itemId;
	}

	function startRename() {
		const b = boards.find((x) => x.id === currentBoardId);
		if (!b) return;
		renameName = b.name;
		renaming = true;
	}

	$effect(() => {
		if (renaming && renameInput) renameInput.focus();
	});

	async function commitRename() {
		if (!renaming) return;
		const name = renameName.trim();
		renaming = false;
		if (!name) return;
		const original = boards.find((b) => b.id === currentBoardId);
		if (!original || name === original.name) return;
		try {
			const renamed = await api.renameBoard(currentBoardId, name);
			boards = boards.map((b) => (b.id === renamed.id ? { ...b, name: renamed.name } : b));
			toast('success', 'Board renamed');
		} catch (e) {
			toast('error', e instanceof Error ? e.message : 'failed to rename board');
		}
	}
</script>

<div class="app">
	<header class="topbar">
		<div class="brand">
			<span class="logo">◆</span>
			<span>buildboard</span>
		</div>

		<CommandPalette
			boards={boards}
			onselectboard={(id) => (currentBoardId = id)}
			onfocusitem={handleSearchSelect}
			onnewitem={(k) => boardActions.create?.(k)}
			onnewboard={() => newBoard()}
			onfitview={() => boardActions.fitView?.()}
			onexport={() => boardActions.export?.()}
			onthemetoggle={() => toggleTheme()}
		/>

		<div class="boards" role="group" aria-label="Board">
			{#if renaming}
				<input
					class="rename"
					bind:this={renameInput}
					bind:value={renameName}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							commitRename();
						} else if (e.key === 'Escape') {
							renaming = false;
						}
					}}
					onblur={commitRename}
				/>
			{:else}
				<select value={currentBoardId} onchange={(e) => (currentBoardId = e.currentTarget.value)}>
					{#each boards as b (b.id)}
						<option value={b.id}>{b.name} ({b.item_count})</option>
					{/each}
				</select>
			{/if}
			<button onclick={startRename} title="Rename board" aria-label="Rename board">✎</button>
			<button onclick={newBoard} title="New board" aria-label="New board">＋</button>
			{#if currentBoardId !== 'default'}
				<button class="ghost" onclick={() => removeBoard(currentBoardId)} title="Delete board" aria-label="Delete board">✕</button>
			{/if}
			<button class="ghost" onclick={() => toggleTheme()} title="Toggle light/dark theme" aria-label="Toggle light/dark theme" aria-pressed={$theme === 'dark'}>
				{$theme === 'dark' ? '☀' : '☾'}
			</button>
		</div>
	</header>

	<SvelteFlowProvider>
		<Board boardId={currentBoardId} boards={boards} focusItem={focusItem} onfocusconsumed={() => (focusItem = null)} onitemchanged={() => void loadBoards()} actions={boardActions} />
	</SvelteFlowProvider>

	<Toast />

	{#if modal}
		<div class="backdrop" onmousedown={() => (modal = null)}>
			<div class="modal" role="dialog" onmousedown={(e) => e.stopPropagation()}>
				{#if modal === 'create'}
					<h3>New board</h3>
					<input
						bind:this={newInput}
						bind:value={newName}
						placeholder="Board name"
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								commitNewBoard();
							} else if (e.key === 'Escape') modal = null;
						}}
					/>
				{:else}
					<h3>Delete “{boards.find((b) => b.id === currentBoardId)?.name}”?</h3>
					<p class="hint">Only works if the board has no items.</p>
				{/if}
				{#if modalError}
					<p class="err">{modalError}</p>
				{/if}
				<div class="row">
					<button class="ghost" onclick={() => (modal = null)}>Cancel</button>
					{#if modal === 'create'}
						<button onclick={commitNewBoard}>Create</button>
					{:else}
						<button class="danger" onclick={commitDelete}>Delete</button>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		height: 100vh;
	}
	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 8px 16px;
		border-bottom: 1px solid var(--border);
		background: var(--bg-raise);
		position: relative;
		z-index: 10;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 15px;
		white-space: nowrap;
	}
	.logo {
		color: var(--accent);
		font-size: 15px;
	}
	.boards {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.boards select,
	.boards input.rename {
		width: auto;
		min-width: 140px;
	}
	.boards button {
		padding: 6px 10px;
	}
	.ghost {
		background: transparent;
	}
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.3);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 50;
	}
	.modal {
		width: 300px;
		overscroll-behavior: contain;
		background: var(--bg-raise);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-3);
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		animation: bb-pop-in var(--t-med) var(--ease-out);
	}
	.modal h3 {
		font-size: 14px;
		font-family: var(--font-display);
	}
	.modal input {
		width: 100%;
	}
	.modal .hint {
		font-size: 12px;
		color: var(--text-dim);
	}
	.modal .err {
		font-size: 12px;
		color: #e5484d;
	}
	.modal .row {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.danger {
		color: #e5484d;
	}
</style>
