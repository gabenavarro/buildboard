<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import { getContext } from 'svelte';
	import type { Item, ItemKind, ItemStatus, Decision } from '$lib/types.js';
	import { ITEM_STATUSES } from '$lib/types.js';
	import { api } from '$lib/api.js';
	import { toast } from '$lib/toast.js';

	let {
		data,
		selected = false
	}: { data: { item: Item; i: number; decision?: Decision | null }; selected?: boolean } = $props();
	const item = $derived(data.item);
	const decision = $derived(data.decision ?? null);
	const onstatus = getContext<((item: Item) => void) | undefined>('board:statuschange');
	const ondelete = getContext<((id: string) => void) | undefined>('board:delete');
	const ondecisionresolved = getContext<((decision: Decision, item: Item, unblocked: Item[]) => void) | undefined>(
		'board:decisionresolved'
	);

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

	function copyRef(e: MouseEvent) {
		e.stopPropagation();
		e.preventDefault();
		const ref = decision?.ref;
		if (!ref) return;
		const text = `#${ref}`;
		void navigator.clipboard
			?.writeText(text)
			.then(
				() => toast('success', `Copied ${text}`),
				() => toast('error', 'copy failed')
			);
	}

	async function chooseOption(opt: string) {
		if (!decision || decision.choice) return;
		const prev = decision;
		data.decision = { ...decision, choice: opt };
		try {
			const res = await api.resolveDecision(decision.id, { choice: opt });
			data.decision = res.decision;
			ondecisionresolved?.(res.decision, res.item, res.unblocked);
			toast('success', `Resolved: ${opt}`);
		} catch (err) {
			data.decision = prev;
			toast('error', err instanceof Error ? err.message : 'resolve failed');
		}
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
		{#if item.kind === 'decision' && decision?.ref}
			<button class="ref-chip" title="Copy ref" aria-label="Copy ref {decision.ref}" onclick={copyRef}>
				#{decision.ref}
			</button>
		{/if}
		<button
			class="status {statusClass(item.status)}"
			title={item.status}
			aria-label={`Status: ${item.status}. Click to cycle.`}
			onclick={cycleStatus}
		>
			{statusIcon(item.status)}
		</button>
		{#if selected}
			<button class="del" title="Delete" aria-label="Delete item" onclick={(e) => { e.stopPropagation(); ondelete?.(item.id); }}>
				✕
			</button>
		{/if}
	</div>
	<div class="title">{item.title}</div>
	{#if preview}
		<div class="preview">{preview}</div>
	{/if}
	{#if item.kind === 'decision' && decision}
		<div class="dec-state {decision.choice ? 'is-resolved' : 'is-open'}">
			{#if decision.choice}
				<span class="dec-glyph">✓</span>
				<span class="dec-choice">{decision.choice}</span>
			{:else}
				<span class="dec-glyph">○</span>
				<span class="dec-choice">unresolved</span>
			{/if}
		</div>
		{#if decision.options.length > 0}
			<div class="opts {decision.choice ? 'is-resolved' : ''}">
				{#each decision.options as opt (opt)}
					<button
						class="opt-chip {decision.choice === opt ? 'chosen' : ''}"
						onclick={(e) => {
							e.stopPropagation();
							e.preventDefault();
							chooseOption(opt);
						}}
					>
						{opt}
					</button>
				{/each}
			</div>
		{/if}
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
		align-items: center;
		gap: 4px;
		margin-bottom: 6px;
	}
	.badge {
		margin-right: auto;
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
	.del {
		display: grid;
		place-items: center;
		min-width: 22px;
		height: 22px;
		background: transparent;
		border: 1px solid var(--border-soft);
		border-radius: 999px;
		padding: 0;
		font-size: 11px;
		line-height: 1;
		color: var(--text-dim);
		transition: border-color var(--t-fast) var(--ease-out), background var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out);
	}
	.del:hover {
		background: var(--accent-soft);
		border-color: var(--accent);
		color: var(--text);
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
	.status.st-open {
		color: var(--text-dim);
	}
	.status.st-progress {
		color: var(--kind-task);
	}
	.status.st-done {
		color: var(--kind-plan);
	}
	.status.st-blocked {
		color: var(--danger);
		border-color: var(--danger);
	}
	.ref-chip {
		margin-left: 2px;
		font-family: var(--mono, ui-monospace, monospace);
		font-size: 10px;
		color: var(--kind-decision);
		background: color-mix(in srgb, var(--kind-decision) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--kind-decision) 30%, transparent);
		border-radius: 4px;
		padding: 1px 5px;
		cursor: pointer;
	}
	.ref-chip:hover {
		background: color-mix(in srgb, var(--kind-decision) 22%, transparent);
	}
	.dec-state {
		display: flex;
		align-items: center;
		gap: 5px;
		margin-top: 6px;
		font-size: 11px;
	}
	.dec-state.is-open .dec-glyph,
	.dec-state.is-open .dec-choice {
		color: var(--decision-open);
	}
	.dec-state.is-resolved .dec-glyph,
	.dec-state.is-resolved .dec-choice {
		color: var(--decision-resolved);
	}
	.dec-glyph {
		font-size: 12px;
	}
	.opts {
		margin-top: 6px;
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.opt-chip {
		font-size: 11px;
		color: var(--text);
		background: var(--bg-raise-2);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 2px 8px;
		cursor: pointer;
		transition:
			border-color var(--t-fast) var(--ease-out),
			background var(--t-fast) var(--ease-out);
	}
	.opt-chip:hover {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.opts.is-resolved .opt-chip {
		cursor: default;
		opacity: 0.55;
	}
	.opts.is-resolved .opt-chip.chosen {
		opacity: 1;
		color: var(--decision-resolved);
		border-color: var(--decision-resolved);
		background: color-mix(in srgb, var(--decision-resolved) 14%, transparent);
	}
</style>
