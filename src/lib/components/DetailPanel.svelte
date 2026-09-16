<script lang="ts">
	import { api } from '$lib/api.js';
	import type { Item, ItemKind, ItemStatus } from '$lib/db.js';

	let {
		item,
		onclose,
		ondelete,
		onupdated
	}: {
		item: Item;
		onclose: () => void;
		ondelete: (id: string) => void;
		onupdated: (item: Item) => void;
	} = $props();

	const KINDS: ItemKind[] = ['note', 'concept', 'task', 'plan', 'decision', 'agent_task'];
	const STATUSES: ItemStatus[] = ['open', 'in_progress', 'done', 'blocked'];

	let title = $state(item.title);
	let kind = $state<ItemKind>(item.kind);
	let status = $state<ItemStatus>(item.status);
	let tagsText = $state(item.tags.join(', '));
	let bodyMd = $state(item.body_md);
	let saving = $state(false);
	let error = $state('');

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
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to save';
		} finally {
			saving = false;
		}
	}

	function remove() {
		ondelete(item.id);
	}
</script>

<aside class="panel">
	<header>
		<span class="eyebrow">item</span>
		<button class="icon" onclick={onclose} aria-label="Close">✕</button>
	</header>

	<label>
		<span>Title</span>
		<input value={title} oninput={(e) => (title = e.currentTarget.value)} />
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
		<span>Body (markdown)</span>
		<textarea rows={10} value={bodyMd} oninput={(e) => (bodyMd = e.currentTarget.value)}></textarea>
	</label>

	{#if error}
		<p class="error">{error}</p>
	{/if}

	<footer>
		<button class="danger" onclick={remove}>Delete</button>
		<button class="primary" onclick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
	</footer>
</aside>

<style>
	.panel {
		width: 320px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		background: var(--bg-raise);
		border-left: 1px solid var(--border);
		padding: 16px;
		height: 100%;
		overflow-y: auto;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.eyebrow {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-dim);
	}
	.icon {
		padding: 2px 8px;
		background: transparent;
		border: none;
		color: var(--text-dim);
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
	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
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
