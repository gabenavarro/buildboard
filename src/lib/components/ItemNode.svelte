<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import { getContext } from 'svelte';
	import type { Item, ItemKind, ItemStatus } from '$lib/types.js';
	import { ITEM_STATUSES } from '$lib/types.js';
	import { api } from '$lib/api.js';

	let { data }: { data: { item: Item; i: number } } = $props();
	const item = $derived(data.item);
	const onstatus = getContext<((item: Item) => void) | undefined>('board:statuschange');

	let prevStatus = $state(item.status);
	let pulsing = $state(false);
	$effect(() => {
		if (item.status !== prevStatus) {
			prevStatus = item.status;
			pulsing = true;
			const t = setTimeout(() => (pulsing = false), 400);
			return () => clearTimeout(t);
		}
	});

	function cycleStatus(e: MouseEvent) {
		e.stopPropagation();
		e.preventDefault();
		const next = ITEM_STATUSES[(ITEM_STATUSES.indexOf(item.status) + 1) % ITEM_STATUSES.length];
		api
			.updateItem(item.id, { status: next })
			.then((updated) => onstatus?.(updated))
			.catch((err) => console.error(err));
	}

	function statusClass(status: ItemStatus): string {
		const map: Record<ItemStatus, string> = {
			open: 'st-open',
			in_progress: 'st-progress',
			done: 'st-done',
			blocked: 'st-blocked'
		};
		return map[status];
	}

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

<div
	class="card {item.status === 'done' ? 'is-done' : ''} {item.status === 'blocked' ? 'is-blocked' : ''}"
	style="--kind: {kindColor(item.kind)}; --bb-i: {data.i}"
>
	<Handle type="target" position={Position.Top} />
	<Handle type="target" position={Position.Left} />
	<Handle type="source" position={Position.Right} />
	<Handle type="source" position={Position.Bottom} />

	<div class="head">
		<span class="badge" style="background: {kindColor(item.kind)}">{item.kind}</span>
		<button
			class="status {statusClass(item.status)} {pulsing ? 'is-pulsing' : ''}"
			title={item.status}
			aria-label={`Status: ${item.status}. Click to cycle.`}
			onclick={cycleStatus}
		>
			{statusIcon(item.status)}
		</button>
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
		border-left: 3px solid var(--kind);
		border-radius: var(--radius);
		padding: 10px 12px;
		box-shadow:
			var(--shadow-2),
			0 0 22px color-mix(in srgb, var(--kind) 14%, transparent);
		transition:
			box-shadow var(--t-fast) var(--ease-out),
			border-color var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-out);
		animation: bb-node-in 260ms var(--ease-out) both;
		animation-delay: calc(min(var(--bb-i, 0) * 22ms, 320ms));
	}
	.card:hover {
		border-color: color-mix(in srgb, var(--kind) 55%, var(--border));
		box-shadow:
			var(--shadow-3),
			0 0 28px color-mix(in srgb, var(--kind) 24%, transparent);
	}
	.card.is-done {
		opacity: 0.6;
	}
	.card.is-done .title {
		text-decoration: line-through;
		color: var(--text-dim);
	}
	.card.is-blocked {
		border-color: var(--danger);
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 6px;
	}
	.badge {
		font-family: var(--font-display);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: #0b0e14;
		border-radius: 999px;
		padding: 2px 8px;
	}
	.status {
		display: grid;
		place-items: center;
		min-width: 22px;
		height: 22px;
		background: transparent;
		border: 1px solid var(--border-soft);
		border-radius: 999px;
		padding: 0;
		font-size: 13px;
		line-height: 1;
		transition: border-color var(--t-fast) var(--ease-out), background var(--t-fast) var(--ease-out);
	}
	.status:hover {
		background: var(--accent-soft);
		border-color: var(--accent);
	}
	.status.is-pulsing {
		animation: bb-pulse 400ms var(--ease-spring);
	}
	.title {
		font-weight: 600;
		font-size: 14px;
		line-height: 1.3;
		letter-spacing: -0.005em;
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
