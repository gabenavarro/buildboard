<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api.js';
	import type { Item, Concept } from '$lib/db.js';

	let { item }: { item: Item } = $props();

	let concept = $state<Concept | null>(null);
	let creating = $state(false);
	let name = $state(item.title);
	let definition = $state('');
	let details = $state('');
	let source = $state('');

	async function load() {
		try {
			const concepts = await api.listConcepts();
			concept = concepts.find((c) => c.item_id === item.id) ?? null;
			if (concept) {
				name = concept.name;
				definition = concept.definition;
				details = concept.details_md;
				source = concept.source ?? '';
			}
		} catch (e) {
			console.error(e);
		}
		creating = false;
	}

	onMount(load);

	async function save() {
		if (!name.trim()) return;
		try {
			if (concept) {
				const updated = await api.updateConcept(concept.id, {
					name: name.trim(),
					definition: definition.trim(),
					details_md: details,
					source: source.trim() || null
				});
				concept = updated;
			} else {
				const created = await api.createConcept({
					name: name.trim(),
					definition: definition.trim(),
					details_md: details,
					source: source.trim() || null,
					item_id: item.id
				});
				concept = created;
			}
		} catch (e) {
			console.error(e);
		}
	}
</script>

<div class="concept">
	{#if !concept && creating === false}
		<p class="dim">No concept record yet. Define one below.</p>
	{/if}

	<label>
		<span>Name</span>
		<input value={name} oninput={(e) => (name = e.currentTarget.value)} />
	</label>
	<label>
		<span>Definition</span>
		<textarea rows={3} value={definition} oninput={(e) => (definition = e.currentTarget.value)}></textarea>
	</label>
	<label class="grow">
		<span>Details (markdown)</span>
		<textarea rows={10} value={details} oninput={(e) => (details = e.currentTarget.value)}></textarea>
	</label>
	<label>
		<span>Source</span>
		<input value={source} oninput={(e) => (source = e.currentTarget.value)} placeholder="paper, doc, URL…" />
	</label>

	<button class="primary" onclick={save}>Save concept</button>
</div>

<style>
	.concept {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.dim {
		color: var(--text-dim);
		font-size: 12px;
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
