<script lang="ts">
	import type { ItemKind } from '$lib/types.js';

	let { onCreate }: { onCreate: (kind: ItemKind, client: { x: number; y: number }) => void } = $props();

	let open = $state(false);
	let menuRef = $state<HTMLElement | null>(null);

	const KINDS: { kind: ItemKind; label: string }[] = [
		{ kind: 'note', label: 'Note' },
		{ kind: 'concept', label: 'Concept' },
		{ kind: 'task', label: 'Task' },
		{ kind: 'plan', label: 'Plan' },
		{ kind: 'decision', label: 'Decision' },
		{ kind: 'agent_task', label: 'Agent task' }
	];

	function pick(kind: ItemKind, e: MouseEvent) {
		open = false;
		onCreate(kind, { x: e.clientX, y: e.clientY });
	}

	function close(e: MouseEvent) {
		if (menuRef && !menuRef.contains(e.target as Node)) open = false;
	}
</script>

<svelte:window onclick={close} />

<div class="palette" bind:this={menuRef}>
	<button onclick={() => (open = !open)}>＋ New item</button>
	{#if open}
		<ul role="menu">
			{#each KINDS as k (k.kind)}
				<li>
					<button role="menuitem" onclick={(e) => pick(k.kind, e)}>{k.label}</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.palette {
		position: relative;
	}
	.palette > button {
		background: linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 78%, #12203d));
		border-color: color-mix(in srgb, var(--accent) 60%, transparent);
		color: #fff;
		font-weight: 600;
		box-shadow: 0 0 18px var(--accent-glow);
	}
	.palette > button:hover {
		border-color: var(--accent);
		box-shadow: 0 0 26px var(--accent-glow);
	}
	ul {
		position: absolute;
		right: 0;
		top: calc(100% + 6px);
		margin: 0;
		padding: 6px;
		list-style: none;
		background: var(--glass-strong);
		backdrop-filter: var(--glass-blur);
		-webkit-backdrop-filter: var(--glass-blur);
		border: 1px solid var(--border-soft);
		border-radius: 10px;
		box-shadow: var(--shadow-3);
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 150px;
		z-index: 10;
	}
	li button {
		width: 100%;
		text-align: left;
		border: none;
		background: transparent;
		padding: 6px 10px;
		border-radius: 6px;
	}
	li button:hover {
		background: var(--accent-soft);
		border-color: transparent;
	}
</style>
