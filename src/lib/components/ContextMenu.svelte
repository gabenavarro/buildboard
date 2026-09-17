<script lang="ts">
	import type { Item, BoardWithCount } from '$lib/types.js';

	let {
		x,
		y,
		item,
		boards,
		onclose,
		onmove,
		onduplicate
	}: {
		x: number;
		y: number;
		item: Item;
		boards: BoardWithCount[];
		onclose: () => void;
		onmove: (item: Item, boardId: string) => void;
		onduplicate: (item: Item, boardId?: string) => void;
	} = $props();

	const otherBoards = boards.filter((b) => b.id !== item.board_id);
</script>

<div class="backdrop" onmousedown={onclose} oncontextmenu={(e) => e.preventDefault()}></div>
<div
	class="menu"
	style="left: {Math.min(x, window.innerWidth - 220)}px; top: {Math.min(y, window.innerHeight - 200)}px;"
	role="menu"
>
	<button role="menuitem" class="title" disabled>{item.title}</button>
	<button
		role="menuitem"
		onclick={() => {
			const it = item;
			onclose();
			onduplicate(it);
		}}
	>
		Duplicate
	</button>
	{#if otherBoards.length > 0}
		<span class="sep">Move to</span>
		{#each otherBoards as b (b.id)}
			<button
				role="menuitem"
				onclick={() => {
					const it = item;
					onclose();
					onmove(it, b.id);
				}}
			>
				→ {b.name}
			</button>
		{/each}
		<span class="sep">Duplicate to</span>
		{#each otherBoards as b (b.id)}
			<button
				role="menuitem"
				onclick={() => {
					const it = item;
					onclose();
					onduplicate(it, b.id);
				}}
			>
				⇢ {b.name}
			</button>
		{/each}
	{/if}
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 40;
	}
	.menu {
		position: fixed;
		z-index: 41;
		min-width: 190px;
		max-width: 240px;
		background: var(--glass-strong);
		backdrop-filter: var(--glass-blur);
		-webkit-backdrop-filter: var(--glass-blur);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		box-shadow: var(--shadow-3);
		padding: 4px;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.menu button {
		text-align: left;
		padding: 6px 10px;
		font-size: 13px;
		border-radius: 5px;
		border: none;
		background: transparent;
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.menu button:hover {
		background: var(--accent-soft);
	}
	.menu button.title {
		cursor: default;
		font-weight: 600;
		color: var(--text-dim);
		font-size: 12px;
	}
	.menu button.title:hover {
		background: transparent;
	}
	.sep {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-dim);
		padding: 6px 10px 2px;
	}
</style>
