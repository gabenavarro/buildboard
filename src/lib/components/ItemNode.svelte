<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import type { Item, ItemKind, ItemStatus } from '$lib/db.js';

	let { data } = $props();
	const item = $derived(data as Item);

	const kindColor = (kind: ItemKind) => {
		const map: Record<ItemKind, string> = {
			note: 'var(--kind-note)',
			concept: 'var(--kind-concept)',
			task: 'var(--kind-task)',
			plan: 'var(--kind-plan)',
			decision: 'var(--kind-decision)',
			agent_task: 'var(--kind-agent_task)'
		};
		return map[kind];
	};

	const statusIcon = (status: ItemStatus) => {
		const map: Record<ItemStatus, string> = {
			open: '○',
			in_progress: '◐',
			done: '●',
			blocked: '⊘'
		};
		return map[status];
	};
</script>

<div class="card" style="--kind: {kindColor(item.kind)}">
	<Handle type="target" position={Position.Top} />
	<Handle type="target" position={Position.Left} />
	<Handle type="source" position={Position.Right} />
	<Handle type="source" position={Position.Bottom} />

	<div class="head">
		<span class="badge" style="background: {kindColor(item.kind)}">{item.kind}</span>
		<span class="status" title={item.status}>{statusIcon(item.status)}</span>
	</div>
	<div class="title">{item.title}</div>
	{#if item.tags.length > 0}
		<div class="tags">
			{#each item.tags as tag (tag)}
				<span class="tag">{tag}</span>
			{/each}
		</div>
	{/if}
</div>

<style>
	.card {
		width: 200px;
		background: var(--bg-raise);
		border: 1px solid var(--border);
		border-left: 4px solid var(--kind);
		border-radius: var(--radius);
		padding: 10px 12px;
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 6px;
	}
	.badge {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #0b0e14;
		border-radius: 5px;
		padding: 2px 6px;
	}
	.status {
		color: var(--text-dim);
		font-size: 14px;
	}
	.title {
		font-weight: 600;
		font-size: 14px;
		line-height: 1.3;
		word-break: break-word;
	}
	.tags {
		margin-top: 8px;
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.tag {
		font-size: 10px;
		color: var(--text-dim);
		background: var(--bg-raise-2);
		border-radius: 4px;
		padding: 1px 5px;
	}
</style>
