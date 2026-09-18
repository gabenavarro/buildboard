<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import { getContext } from 'svelte';
	import { api } from '$lib/api.js';
	import type { Item } from '$lib/types.js';

	let { data }: { data: { item: Item; i: number } } = $props();
	const item = $derived(data.item);
	const onitemupdated = getContext<((item: Item) => void) | undefined>('board:itemupdated');

	let editing = $state(false);
	let draft = $state('');
	let taRef = $state<HTMLTextAreaElement | null>(null);

	function startEdit() {
		draft = item.body_md;
		editing = true;
	}

	function commit() {
		if (!editing) return;
		editing = false;
		const next = draft;
		if (next !== item.body_md) {
			api
				.updateItem(item.id, { body_md: next })
				.then((u) => onitemupdated?.(u))
				.catch((e) => console.error(e));
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' || e.key === 'Enter') {
			e.preventDefault();
			commit();
			taRef?.blur();
		}
	}

	$effect(() => {
		if (editing && taRef) {
			taRef.focus();
			taRef.select();
		}
	});
</script>

<div class="text" style="--bb-i: {data.i}">
	<Handle id="top" type="source" position={Position.Top} />
	<Handle id="top" type="target" position={Position.Top} />
	<Handle id="right" type="source" position={Position.Right} />
	<Handle id="right" type="target" position={Position.Right} />
	<Handle id="bottom" type="source" position={Position.Bottom} />
	<Handle id="bottom" type="target" position={Position.Bottom} />
	<Handle id="left" type="source" position={Position.Left} />
	<Handle id="left" type="target" position={Position.Left} />

	{#if editing}
		<textarea
			class="edit nodrag"
			bind:this={taRef}
			bind:value={draft}
			rows={1}
			aria-label="Edit text label"
			onblur={commit}
			onkeydown={handleKeydown}
		></textarea>
	{:else}
		<div class="txt" role="button" tabindex={0} onclick={startEdit} onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); startEdit(); } }}>
			{item.body_md ? item.body_md : 'Type…'}
		</div>
	{/if}
</div>

<style>
	.text {
		position: relative;
		min-width: 48px;
		min-height: 28px;
		padding: 6px 12px;
		background: transparent;
		border: 1.5px dashed transparent;
		border-radius: 8px;
		font-family: var(--font-body);
		font-size: 15px;
		line-height: 1.4;
		color: var(--text);
		transition:
			border-color var(--t-fast) var(--ease-out),
			background var(--t-fast) var(--ease-out);
		animation: bb-fade-in var(--t-med) var(--ease-out) both;
	}
	.text:hover {
		border-color: var(--border);
	}
	.txt {
		cursor: text;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.txt:empty::before {
		content: attr(data-placeholder);
		color: var(--text-faint);
	}
	.text.selected,
	.text.selected:hover {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.edit {
		width: 100%;
		min-width: 80px;
		border: none;
		outline: none;
		resize: none;
		background: var(--bg-raise);
		border-radius: 6px;
		padding: 2px 6px;
		font-family: var(--font-body);
		font-size: 15px;
		line-height: 1.4;
		color: var(--text);
	}
</style>
