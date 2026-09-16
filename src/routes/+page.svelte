<script lang="ts">
	import { SvelteFlowProvider } from '@xyflow/svelte';

	import Board from '$lib/components/Board.svelte';
</script>

<div class="app">
	<header class="topbar">
		<div class="brand">
			<span class="logo">◆</span>
			<span>buildboard</span>
		</div>
		<div class="meta">
			<span class="count">whiteboard · decisions · subagents</span>
		</div>
	</header>

	<SvelteFlowProvider>
		<Board />
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
	}
	.logo {
		color: var(--accent);
	}
	.meta {
		flex: 1;
	}
	.count {
		font-size: 12px;
		color: var(--text-dim);
	}
</style>
