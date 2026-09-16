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
		const name = prompt('Board name?');
		if (!name?.trim()) return;
		const b = await api.createBoard(name.trim());
		currentBoardId = b.id;
		await loadBoards();
	}

	async function removeBoard(id: string) {
		if (id === 'default') return;
		if (!confirm('Delete this board? (only works if it has no items)')) return;
		try {
			await api.deleteBoard(id);
			if (currentBoardId === id) currentBoardId = 'default';
			await loadBoards();
		} catch (e) {
			alert(e instanceof Error ? e.message : 'failed to delete board');
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
		<Board boardId={currentBoardId} focusItem={focusItem} onfocusconsumed={() => (focusItem = null)} />
	</SvelteFlowProvider>
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
	.meta {
		flex: 1;
		text-align: right;
	}
	.count {
		font-size: 12px;
		color: var(--text-dim);
	}
</style>
