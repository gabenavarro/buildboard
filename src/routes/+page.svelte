<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteFlowProvider } from '@xyflow/svelte';

	import Board from '$lib/components/Board.svelte';
	import { api } from '$lib/api.js';
	import type { Board as BoardModel } from '$lib/db.js';

	let boards = $state<BoardModel[]>([]);
	let currentBoardId = $state('default');

	onMount(async () => {
		try {
			boards = await api.listBoards();
		} catch (e) {
			console.error(e);
		}
	});

	async function newBoard() {
		const name = prompt('Board name?');
		if (!name?.trim()) return;
		const b = await api.createBoard(name.trim());
		boards = [...boards, b];
		currentBoardId = b.id;
	}

	async function removeBoard(id: string) {
		if (id === 'default') return;
		if (!confirm('Delete this board? (only works if it has no items)')) return;
		try {
			await api.deleteBoard(id);
			boards = boards.filter((b) => b.id !== id);
			if (currentBoardId === id) currentBoardId = 'default';
		} catch (e) {
			alert(e instanceof Error ? e.message : 'failed to delete board');
		}
	}
</script>

<div class="app">
	<header class="topbar">
		<div class="brand">
			<span class="logo">◆</span>
			<span>buildboard</span>
		</div>

		<div class="boards">
			<select value={currentBoardId} onchange={(e) => (currentBoardId = e.currentTarget.value)}>
				{#each boards as b (b.id)}
					<option value={b.id}>{b.name}</option>
				{/each}
			</select>
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
		<Board boardId={currentBoardId} />
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
	.boards select {
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
