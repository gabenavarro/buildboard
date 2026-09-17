<script lang="ts">
	import { api } from '$lib/api.js';
	import type { Item, ItemKind, ItemStatus } from '$lib/types.js';
	import ThreadTab from './ThreadTab.svelte';
	import DecisionTab from './DecisionTab.svelte';
	import MarkdownView from './MarkdownView.svelte';
	import ConceptTab from './ConceptTab.svelte';
	import AgentTab from './AgentTab.svelte';
	import { toast } from '$lib/toast.js';

	let {
		item,
		autofocusTitle = false,
		onclose,
		ondelete,
		onupdated
	}: {
		item: Item;
		autofocusTitle?: boolean;
		onclose: () => void;
		ondelete: (id: string) => void;
		onupdated: (item: Item) => void;
	} = $props();

	let titleInput = $state<HTMLInputElement | null>(null);

	$effect(() => {
		if (autofocusTitle) {
			titleInput?.focus();
			titleInput?.select();
		}
	});

	const KINDS: ItemKind[] = ['note', 'concept', 'task', 'plan', 'decision', 'agent_task'];
	const STATUSES: ItemStatus[] = ['open', 'in_progress', 'done', 'blocked'];

	type Tab = 'item' | 'thread' | 'decisions' | 'concept' | 'agent';
	let tab = $state<Tab>('item');

	let title = $state(item.title);
	let kind = $state<ItemKind>(item.kind);
	let status = $state<ItemStatus>(item.status);
	let tagsText = $state(item.tags.join(', '));
	let bodyMd = $state(item.body_md);
	let bodyView = $state<'raw' | 'rendered'>('raw');
	let saving = $state(false);
	let error = $state('');

	function canonTags(text: string): string {
		return text
			.split(',')
			.map((t) => t.trim())
			.filter((t) => t.length > 0)
			.join(', ');
	}

	const dirty = $derived(
		title !== item.title ||
			kind !== item.kind ||
			status !== item.status ||
			canonTags(tagsText) !== canonTags(item.tags.join(', ')) ||
			bodyMd !== item.body_md
	);

	async function save() {
		saving = true;
		error = '';
		try {
			const tags = tagsText
				.split(',')
				.map((t) => t.trim())
				.filter((t) => t.length > 0);
			const updated = await api.updateItem(item.id, { title, kind, status, tags, body_md: bodyMd });
			onupdated(updated);
			toast('success', 'Saved');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save';
			toast('error', e instanceof Error ? e.message : 'Failed to save');
		} finally {
			saving = false;
		}
	}

	function remove() {
		ondelete(item.id);
	}

	$effect(() => {
		function onKeydown(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
				e.preventDefault();
				void save();
			}
		}
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});

	const tabs: { id: Tab; label: string; show: boolean }[] = [
		{ id: 'item', label: 'Item', show: true },
		{ id: 'thread', label: 'Thread', show: true },
		{ id: 'decisions', label: 'Decisions', show: true },
		{ id: 'concept', label: 'Concept', show: item.kind === 'concept' },
		{ id: 'agent', label: 'Agent', show: true }
	];
</script>

<aside class="panel">
	<header>
		<span class="head-left">
			<span class="eyebrow">item</span>
			{#if dirty}<span class="unsaved" aria-live="polite">● unsaved</span>{/if}
		</span>
		<button class="icon" onclick={onclose} aria-label="Close">✕</button>
	</header>

	<nav class="tabs">
		{#each tabs.filter((t) => t.show) as t (t.id)}
			<button class:active={tab === t.id} onclick={() => (tab = t.id)}>{t.label}</button>
		{/each}
	</nav>

	{#if tab === 'item'}
		<div class="tabbody">
			<label>
				<span>Title</span>
				<input
					bind:this={titleInput}
					value={title}
					oninput={(e) => (title = e.currentTarget.value)}
				/>
			</label>

			<div class="row">
				<label>
					<span>Kind</span>
					<select value={kind} onchange={(e) => (kind = e.currentTarget.value as ItemKind)}>
						{#each KINDS as k (k)}
							<option value={k}>{k}</option>
						{/each}
					</select>
				</label>
				<label>
					<span>Status</span>
					<select value={status} onchange={(e) => (status = e.currentTarget.value as ItemStatus)}>
						{#each STATUSES as s (s)}
							<option value={s}>{s}</option>
						{/each}
					</select>
				</label>
			</div>

			<label>
				<span>Tags (comma-separated)</span>
				<input value={tagsText} oninput={(e) => (tagsText = e.currentTarget.value)} />
			</label>

			<label class="grow">
				<span class="body-head">
					<span>Body (markdown)</span>
					<span class="view-toggle">
						<button type="button" class:active={bodyView === 'raw'} onclick={() => (bodyView = 'raw')}>Raw</button>
						<button type="button" class:active={bodyView === 'rendered'} onclick={() => (bodyView = 'rendered')}>Rendered</button>
					</span>
				</span>
				{#if bodyView === 'raw'}
					<textarea rows={10} value={bodyMd} oninput={(e) => (bodyMd = e.currentTarget.value)}></textarea>
				{:else}
					<div class="body-preview">
						<MarkdownView text={bodyMd} />
					</div>
				{/if}
			</label>

			{#if error}
				<p class="error">{error}</p>
			{/if}

			<footer>
				<button class="danger" onclick={remove}>Delete</button>
				<button class="primary" onclick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
			</footer>
		</div>
	{:else if tab === 'thread'}
		<div class="tabbody fill">
			<ThreadTab item={item} />
		</div>
	{:else if tab === 'decisions'}
		<div class="tabbody scroll">
			<DecisionTab item={item} />
		</div>
	{:else if tab === 'concept'}
		<div class="tabbody fill">
			<ConceptTab item={item} />
		</div>
	{:else if tab === 'agent'}
		<div class="tabbody scroll">
			<AgentTab item={item} />
		</div>
	{/if}
</aside>

<style>
	.panel {
		width: 340px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		background: var(--bg-raise);
		border-left: 1px solid var(--border);
		padding: 16px;
		height: 100%;
		min-height: 0;
		animation: bb-slide-in var(--t-med) var(--ease-out);
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.head-left {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.eyebrow {
		font-family: var(--font-display);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--text-dim);
	}
	.unsaved {
		font-size: 11px;
		color: var(--accent);
	}
	.icon {
		padding: 2px 8px;
		background: transparent;
		border: none;
		color: var(--text-dim);
	}
	.tabs {
		display: flex;
		gap: 4px;
		border-bottom: 1px solid var(--border);
	}
	.tabs button {
		flex: 1;
		border: none;
		border-bottom: 2px solid transparent;
		background: transparent;
		border-radius: 0;
		padding: 6px 4px;
		font-size: 12px;
		color: var(--text-dim);
		transition: color var(--t-fast) var(--ease-out), border-color var(--t-fast) var(--ease-out);
	}
	.tabs button:hover {
		color: var(--text);
	}
	.tabs button.active {
		color: var(--text);
		border-bottom-color: var(--accent);
	}
	.tabbody {
		display: flex;
		flex-direction: column;
		gap: 12px;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
	.tabbody.fill {
		overflow: hidden;
	}
	.tabbody.scroll {
		overflow-y: auto;
	}
	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: var(--text-dim);
	}
	label.grow {
		flex: 1;
	}
	.body-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.view-toggle {
		display: flex;
		gap: 4px;
	}
	.view-toggle button {
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 6px;
		background: var(--bg);
		color: var(--text-dim);
	}
	.view-toggle button.active {
		background: var(--accent-soft);
		border-color: var(--accent);
		color: var(--accent);
	}
	.body-preview {
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg);
		padding: 10px;
		min-height: 120px;
		overflow-y: auto;
	}
	textarea {
		resize: vertical;
		min-height: 120px;
		font-family: ui-monospace, monospace;
		font-size: 12px;
	}
	footer {
		display: flex;
		justify-content: space-between;
	}
	.error {
		margin: 0;
		color: var(--danger);
		font-size: 12px;
	}
	.primary {
		background: var(--accent);
		color: #fff;
		border-color: var(--accent);
	}
	.danger {
		color: var(--danger);
		border-color: color-mix(in srgb, var(--danger) 40%, transparent);
	}
</style>
