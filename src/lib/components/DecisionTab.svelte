<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api.js';
	import type { Item, Decision } from '$lib/db.js';

	let { item }: { item: Item } = $props();

	let decisions = $state<Decision[]>([]);
	let loading = $state(true);

	let question = $state('');
	let optionsText = $state('');
	let choice = $state('');
	let rationale = $state('');

	async function load() {
		loading = true;
		try {
			decisions = await api.listDecisions(item.id);
		} catch (e) {
			console.error(e);
		}
		loading = false;
	}

	onMount(load);

	async function add() {
		if (!question.trim()) return;
		const options = optionsText
			.split('\n')
			.map((o) => o.trim())
			.filter(Boolean);
		const d = await api.createDecision({
			item_id: item.id,
			question: question.trim(),
			options,
			choice: choice.trim() || null,
			rationale: rationale.trim()
		});
		decisions = [d, ...decisions];
		question = '';
		optionsText = '';
		choice = '';
		rationale = '';
	}

	async function supersede(d: Decision) {
		await api.updateDecision(d.id, { status: 'superseded' });
		load();
	}

	async function remove(d: Decision) {
		await api.deleteDecision(d.id);
		load();
	}
</script>

<div class="decisions">
	{#if loading}
		<p class="dim">loading…</p>
	{:else}
		<div class="list">
			{#each decisions as d (d.id)}
				<div class="card {d.status}">
					<div class="q">{d.question}</div>
					{#if d.choice}
						<div class="choice">→ {d.choice}</div>
					{:else}
						<div class="unresolved">unresolved</div>
					{/if}
					{#if d.rationale}
						<div class="rationale">{d.rationale}</div>
					{/if}
					<div class="actions">
						{#if d.status === 'active'}
							<button onclick={() => supersede(d)}>Supersede</button>
						{/if}
						<button onclick={() => remove(d)}>Delete</button>
					</div>
				</div>
			{/each}
			{#if decisions.length === 0}
				<p class="dim">No decisions recorded for this item yet.</p>
			{/if}
		</div>

		<div class="form">
			<label>
				<span>Question</span>
				<input value={question} oninput={(e) => (question = e.currentTarget.value)} />
			</label>
			<label>
				<span>Options (one per line)</span>
				<textarea rows={3} value={optionsText} oninput={(e) => (optionsText = e.currentTarget.value)}></textarea>
			</label>
			<label>
				<span>Choice</span>
				<input value={choice} oninput={(e) => (choice = e.currentTarget.value)} />
			</label>
			<label>
				<span>Rationale</span>
				<textarea rows={2} value={rationale} oninput={(e) => (rationale = e.currentTarget.value)}></textarea>
			</label>
			<button class="primary" onclick={add} disabled={!question.trim()}>Record decision</button>
		</div>
	{/if}
</div>

<style>
	.decisions {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.dim {
		color: var(--text-dim);
		font-size: 12px;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.card {
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 10px;
		background: var(--bg);
	}
	.card.superseded {
		opacity: 0.55;
	}
	.q {
		font-weight: 600;
		font-size: 13px;
	}
	.choice {
		margin-top: 4px;
		font-size: 12px;
		color: var(--kind-plan);
	}
	.unresolved {
		margin-top: 4px;
		font-size: 12px;
		color: var(--kind-decision);
	}
	.rationale {
		margin-top: 4px;
		font-size: 12px;
		color: var(--text-dim);
	}
	.actions {
		margin-top: 8px;
		display: flex;
		gap: 6px;
	}
	.actions button {
		font-size: 11px;
		padding: 3px 8px;
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 8px;
		border-top: 1px solid var(--border);
		padding-top: 12px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: var(--text-dim);
	}
	textarea {
		resize: vertical;
		font-size: 12px;
	}
	.primary {
		background: var(--accent);
		color: #fff;
		border-color: var(--accent);
		align-self: flex-start;
	}
</style>
