<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api.js';
	import type { Item, Thread, Message } from '$lib/db.js';

	let { item }: { item: Item } = $props();

	let thread = $state<Thread | null>(null);
	let messages = $state<Message[]>([]);
	let draft = $state('');
	let loading = $state(true);

	async function load() {
		loading = true;
		try {
			const threads = await api.listThreads(item.id);
			if (threads.length > 0) {
				thread = threads[0];
			} else {
				thread = await api.createThread({ title: `Discussion: ${item.title}`, item_id: item.id });
			}
			messages = await api.listMessages(thread.id);
		} catch (e) {
			console.error(e);
		}
		loading = false;
	}

	onMount(load);

	async function send() {
		if (!thread || !draft.trim()) return;
		const msg = await api.createMessage(thread.id, draft.trim(), 'user');
		messages = [...messages, msg];
		draft = '';
	}
</script>

<div class="thread">
	{#if loading}
		<p class="dim">loading…</p>
	{:else if thread}
		<div class="messages">
			{#each messages as msg (msg.id)}
				<div class="msg {msg.role}">
					<span class="role">{msg.role}</span>
					<div class="content">{msg.content}</div>
				</div>
			{/each}
			{#if messages.length === 0}
				<p class="dim">No messages yet. Start the discussion.</p>
			{/if}
		</div>

		<div class="composer">
			<textarea
				rows={3}
				placeholder="Write a message…"
				value={draft}
				oninput={(e) => (draft = e.currentTarget.value)}
				onkeydown={(e) => {
					if ((e.key === 'Enter' || e.key === 'Cmd') && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
				}}></textarea>
			<button onclick={send} disabled={!draft.trim()}>Send</button>
		</div>
	{/if}
</div>

<style>
	.thread {
		display: flex;
		flex-direction: column;
		gap: 10px;
		height: 100%;
		min-height: 0;
	}
	.dim {
		color: var(--text-dim);
		font-size: 12px;
	}
	.messages {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding-bottom: 8px;
	}
	.msg {
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 6px 10px;
		background: var(--bg);
	}
	.msg.subagent {
		border-color: var(--kind-agent_task);
	}
	.msg.agent {
		border-color: var(--accent);
	}
	.role {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
	}
	.content {
		margin-top: 4px;
		font-size: 13px;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.composer {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	textarea {
		resize: none;
	}
</style>
