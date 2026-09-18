<script lang="ts">
	import type { ItemKind } from '$lib/types.js';

	let {
		x,
		y,
		oncreate,
		onclose
	}: {
		x: number;
		y: number;
		oncreate: (kind: ItemKind, client: { x: number; y: number }) => void;
		onclose: () => void;
	} = $props();

	const KINDS: { kind: ItemKind; label: string }[] = [
		{ kind: 'note', label: 'Note' },
		{ kind: 'concept', label: 'Concept' },
		{ kind: 'task', label: 'Task' },
		{ kind: 'plan', label: 'Plan' },
		{ kind: 'decision', label: 'Decision' },
		{ kind: 'agent_task', label: 'Agent task' },
		{ kind: 'text', label: 'Text label' }
	];
</script>

<div class="backdrop" onmousedown={onclose} oncontextmenu={(e) => e.preventDefault()}></div>
<div class="menu" style="left: {Math.min(x, window.innerWidth - 220)}px; top: {Math.min(y, window.innerHeight - 260)}px;" role="menu">
	<button role="menuitem" class="title" disabled>＋ New item here</button>
	{#each KINDS as k (k.kind)}
		<button role="menuitem" onclick={() => { const c = { x, y }; onclose(); oncreate(k.kind, c); }}>{k.label}</button>
	{/each}
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
		min-width: 170px;
		animation: bb-pop-in var(--t-fast) var(--ease-out);
		background: var(--bg-raise);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow-2);
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
</style>
