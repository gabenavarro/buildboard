<script lang="ts">
	let {
		edge,
		onsave,
		onclose
	}: {
		edge: { id: string; label?: string; kind?: string };
		onsave: (id: string, label: string, kind: string) => void;
		onclose: () => void;
	} = $props();

	let label = $state(edge.label || '');
	let kind = $state(edge.kind || 'depends_on');

	const KINDS = ['depends_on', 'relates_to', 'blocks', 'feeds'];

	function save() {
		onsave(edge.id, label, kind);
		onclose();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			save();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			onclose();
		}
	}
</script>

<div class="edge-editor" role="dialog" aria-label="Edit edge" onkeydown={handleKeydown}>
	<label class="field">
		<span>Label</span>
		<input type="text" bind:value={label} placeholder="e.g. blocks, requires" aria-label="Edge label" />
	</label>
	<label class="field">
		<span>Kind</span>
		<select bind:value={kind} aria-label="Edge kind">
			{#each KINDS as k (k)}
				<option value={k}>{k}</option>
			{/each}
		</select>
	</label>
	<div class="row">
		<button class="save" onclick={save}>Save</button>
		<button class="close" onclick={onclose}>Cancel</button>
	</div>
</div>

<style>
	.edge-editor {
		position: absolute;
		top: 12px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 30;
		display: flex;
		gap: 10px;
		align-items: flex-end;
		background: var(--bg-raise);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow-2);
		padding: 10px 12px;
		animation: bb-pop-in var(--t-fast) var(--ease-out);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.field span {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-dim);
	}
	.field input,
	.field select {
		font-size: 13px;
		padding: 5px 8px;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--text);
		min-width: 140px;
	}
	.row {
		display: flex;
		gap: 6px;
	}
	.row button {
		font-size: 12px;
		padding: 6px 12px;
		border-radius: 6px;
		border: 1px solid var(--border);
		cursor: pointer;
	}
	.save {
		background: var(--accent);
		color: #fff;
		border-color: var(--accent);
	}
	.close {
		background: transparent;
		color: var(--text-dim);
	}
</style>
