<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteFlowProvider } from '@xyflow/svelte';

	import Board from '$lib/components/Board.svelte';
	import SearchBox from '$lib/components/SearchBox.svelte';
	import { api } from '$lib/api.js';
	import type { BoardWithCount, SearchHit } from '$lib/types.js';

	const BOARD_KEY = 'buildboard:board';

	let boards = $state<BoardWithCount[]>([]);
	let currentBoardId = $state('default');
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
			const stored = localStorage.getItem(BOARD_KEY);
			currentBoardId = stored && boards.some((b) => b.id === stored) ? stored : 'default';
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
			if (currentBoardId === id) currentBoardId = 'default';
			await loadBoards();
			modal = null;
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
		} catch (e) {
			alert(e instanceof Error ? e.message : 'failed to rename board');
		}
	}
</script>

<div class="app">
	<header class="topbar">
		<div class="brand">
			<span class="logo">◆</span>
			<span>buildboard</span>
		</div>

		<SearchBox boardId={currentBoardId} {boards} onselect={handleSearchSelect} />

		<div class="boards">
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
			<button onclick={startRename} title="Rename board">✎</button>
			<button onclick={newBoard} title="New board">＋</button>
			{#if currentBoardId !== 'default'}
				<button class="ghost" onclick={() => removeBoard(currentBoardId)} title="Delete board">✕</button>
			{/if}
		</div>

		<div class="meta">
			<span class="count">whiteboard · decisions · subagents</span>
		</div>
	</header>

	<SvelteFlowProvider>
		<Board boardId={currentBoardId} boards={boards} focusItem={focusItem} onfocusconsumed={() => (focusItem = null)} onitemchanged={() => void loadBoards()} />
	</SvelteFlowProvider>

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
		padding: 10px 16px;
		border-bottom: 1px solid var(--border);
		background: var(--bg-raise);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 8px;
		font-weight: 700;
		white-space: nowrap;
	}
	.logo {
		color: var(--accent);
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
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 50;
	}
	.modal {
		width: 300px;
		background: var(--bg-raise);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.modal h3 {
		font-size: 14px;
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
	.meta {
		flex: 1;
		text-align: right;
	}
	.count {
		font-size: 12px;
		color: var(--text-dim);
	}
</style>
