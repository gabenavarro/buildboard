<script lang="ts">
	import { onMount } from 'svelte';
	import type { Item, AgentTask } from '$lib/db.js';

	let { item }: { item: Item } = $props();

	const AGENTS = ['general', 'explore', 'plan', 'build'];

	let tasks = $state<AgentTask[]>([]);
	let agent = $state('general');
	let model = $state('');
	let instruction = $state('');
	let starting = $state(false);
	let liveTaskId = $state<string | null>(null);
	let liveText = $state('');
	let liveStatus = $state('');
	let es: EventSource | null = null;
	let running = $derived(!!liveTaskId && liveStatus === 'running');

	async function load() {
		try {
			const data = await fetch(`/api/agent-tasks?item_id=${item.id}&limit=50`).then((r) => r.json());
			tasks = data as AgentTask[];
		} catch (e) {
			console.error(e);
		}
	}

	onMount(load);

	async function start() {
		starting = true;
		try {
			const res = await fetch('/api/agent-tasks', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					item_id: item.id,
					agent: agent || undefined,
					model: model.trim() || undefined,
					instruction: instruction.trim() || undefined
				})
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.error ?? `spawn failed: ${res.status}`);
			}
			const task = (await res.json()) as AgentTask;
			stream(task.id);
			load();
			instruction = '';
		} catch (e) {
			liveStatus = e instanceof Error ? e.message : 'failed to start';
		} finally {
			starting = false;
		}
	}

	function stream(id: string) {
		es?.close();
		liveTaskId = id;
		liveText = '';
		liveStatus = 'running';
		es = new EventSource(`/api/agent-tasks/${id}/events`);
		es.addEventListener('chunk', (e) => {
			liveText += (JSON.parse(e.data as string) as { text: string }).text;
		});
		es.addEventListener('done', (e) => {
			const payload = JSON.parse(e.data as string) as { status: string; note?: string };
			liveStatus = payload.note ? `${payload.status} — ${payload.note}` : payload.status;
			es?.close();
			es = null;
			load();
		});
	}

	async function cancel() {
		if (!liveTaskId) return;
		await fetch(`/api/agent-tasks/${liveTaskId}`, { method: 'POST' });
	}

	async function viewTranscript(id: string) {
		stream(id);
	}
</script>

<div class="agenttab">
	<div class="controls">
		<div class="row">
			<label>
				<span>Agent</span>
				<select value={agent} onchange={(e) => (agent = e.currentTarget.value)}>
					{#each AGENTS as a (a)}
						<option value={a}>{a}</option>
					{/each}
				</select>
			</label>
			<label class="grow">
				<span>Model (optional)</span>
				<input value={model} oninput={(e) => (model = e.currentTarget.value)} placeholder="provider/model" />
			</label>
		</div>
		<label>
			<span>Extra instruction (optional)</span>
			<input value={instruction} oninput={(e) => (instruction = e.currentTarget.value)} placeholder="focus on…" />
		</label>
		<button class="primary" onclick={start} disabled={starting || running}>
			{running ? 'Running…' : starting ? 'Starting…' : 'Expand with subagent'}
		</button>
	</div>

	{#if liveTaskId}
		<div class="live">
			<div class="livehead">
				<span class="status {liveStatus}">{liveStatus}</span>
				{#if liveStatus === 'running'}
					<button onclick={cancel}>Cancel</button>
				{/if}
			</div>
			<pre class="output">{liveText}</pre>
		</div>
	{/if}

	{#if tasks.length > 0}
		<div class="history">
			<h4>Previous runs</h4>
			{#each tasks as t (t.id)}
				<div class="histitem">
					<span class="status {t.status}">{t.status}</span>
					<span class="when">{(t.created_at ?? '').slice(0, 16)}</span>
					<span class="agent">{t.agent ?? 'default'}</span>
					<button onclick={() => viewTranscript(t.id)}>view</button>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.agenttab {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.controls {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.row {
		display: grid;
		grid-template-columns: 110px 1fr;
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
		grid-column: 2;
	}
	.primary {
		background: var(--kind-agent_task);
		color: #0b0e14;
		border-color: var(--kind-agent_task);
		font-weight: 600;
		align-self: flex-start;
	}
	.live {
		border: 1px solid var(--kind-agent_task);
		border-radius: 8px;
		padding: 10px;
		background: var(--bg);
	}
	.livehead {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 6px;
	}
	.output {
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
		font-size: 12px;
		max-height: 300px;
		overflow-y: auto;
		font-family: ui-monospace, monospace;
	}
	.status {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-dim);
	}
	.status.running {
		color: var(--kind-task);
	}
	.status.succeeded {
		color: var(--kind-plan);
	}
	.status.failed {
		color: var(--danger);
	}
	.status.canceled {
		color: var(--kind-decision);
	}
	.history {
		border-top: 1px solid var(--border);
		padding-top: 10px;
	}
	h4 {
		margin: 0 0 8px;
		font-size: 12px;
		color: var(--text-dim);
	}
	.histitem {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11px;
		margin-bottom: 4px;
	}
	.histitem .agent {
		color: var(--text-dim);
	}
	.histitem .when {
		color: var(--text-dim);
	}
	.histitem button {
		margin-left: auto;
		font-size: 11px;
		padding: 2px 8px;
	}
</style>
