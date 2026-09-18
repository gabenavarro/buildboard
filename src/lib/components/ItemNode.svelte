<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import { getContext } from 'svelte';
	import type { Item, ItemKind, ItemStatus } from '$lib/types.js';
	import { ITEM_STATUSES } from '$lib/types.js';
	import { api } from '$lib/api.js';

	let { data }: { data: { item: Item; i: number } } = $props();
	const item = $derived(data.item);
	const onstatus = getContext<((item: Item) => void) | undefined>('board:statuschange');

	// One-line plain-text preview of the body markdown.
	const preview = $derived.by(() => {
		let t = item.body_md.replace(/```[\s\S]*?```/g, ' ');
		t = t.replace(/`([^`]*)`/g, '$1');
		t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
		t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
		t = t.replace(/^[\s>#*+-]+/gm, '');
		t = t.replace(/\|/g, ' ');
		t = t.replace(/[*_~]/g, '');
		t = t.replace(/\s+/g, ' ').trim();
		return t.slice(0, 90);
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
			agent_task: 'var(--kind-agent_task)',
			text: 'var(--text-dim)'
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
	<Handle id="top" type="source" position={Position.Top} />
	<Handle id="top" type="target" position={Position.Top} />
	<Handle id="right" type="source" position={Position.Right} />
	<Handle id="right" type="target" position={Position.Right} />
	<Handle id="bottom" type="source" position={Position.Bottom} />
	<Handle id="bottom" type="target" position={Position.Bottom} />
	<Handle id="left" type="source" position={Position.Left} />
	<Handle id="left" type="target" position={Position.Left} />

	<div class="head">
		<span class="badge">{item.kind}</span>
		<button
			class="status {statusClass(item.status)}"
			title={item.status}
			aria-label={`Status: ${item.status}. Click to cycle.`}
			onclick={cycleStatus}
		>
			{statusIcon(item.status)}
		</button>
	</div>
	<div class="title">{item.title}</div>
	{#if preview}
		<div class="preview">{preview}</div>
	{/if}
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
		width: 210px;
		background: var(--bg-raise);
		border: 1px solid var(--border);
		border-left: 3px solid var(--kind);
		border-radius: var(--radius);
		padding: 10px 12px;
		box-shadow: var(--shadow-1);
		transition:
			box-shadow var(--t-fast) var(--ease-out),
			border-color var(--t-fast) var(--ease-out);
		animation: bb-fade-in var(--t-med) var(--ease-out) both;
	}
	.card:hover {
		border-color: color-mix(in srgb, var(--kind) 45%, var(--border));
		box-shadow: var(--shadow-2);
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
		font-size: 11px;
		font-weight: 500;
		color: color-mix(in srgb, var(--kind) 75%, var(--text));
		background: color-mix(in srgb, var(--kind) 14%, transparent);
		border-radius: var(--radius-sm);
		padding: 1px 7px;
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
	.title {
		font-weight: 600;
		font-size: 14px;
		line-height: 1.3;
		word-break: break-word;
	}
	.preview {
		margin-top: 4px;
		font-size: 12px;
		line-height: 1.4;
		color: var(--text-dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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
