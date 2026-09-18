<script lang="ts">
	import { api } from '$lib/api.js';
	import type { SearchHit, BoardWithCount, ItemKind } from '$lib/types.js';

	let {
		boards,
		onselectboard,
		onfocusitem,
		onnewitem,
		onnewboard,
		onfitview,
		onexport,
		onthemetoggle
	}: {
		boards: BoardWithCount[];
		onselectboard: (id: string) => void;
		onfocusitem: (hit: SearchHit) => void;
		onnewitem: (kind: ItemKind) => void;
		onnewboard: () => void;
		onfitview: () => void;
		onexport: () => void;
		onthemetoggle: () => void;
	} = $props();

	let open = $state(false);
	let query = $state('');
	let hits = $state<SearchHit[]>([]);
	let active = $state(0);
	let inputEl = $state<HTMLInputElement | null>(null);

	const NEW_ITEM: { kind: ItemKind; label: string }[] = [
		{ kind: 'note', label: 'New note' },
		{ kind: 'concept', label: 'New concept' },
		{ kind: 'task', label: 'New task' },
		{ kind: 'plan', label: 'New plan' },
		{ kind: 'decision', label: 'New decision' },
		{ kind: 'agent_task', label: 'New agent task' },
		{ kind: 'text', label: 'New text label' }
	];

	// Cross-board search while typing.
	$effect(() => {
		const q = query.trim();
		if (q.length < 2) {
			hits = [];
			return;
		}
		const timer = setTimeout(async () => {
			try {
				const res = await api.search(q, undefined);
				if (query.trim() !== q) return;
				hits = res.hits;
			} catch {
				/* search failures are non-fatal */
			}
		}, 200);
		return () => clearTimeout(timer);
	});

	const q = $derived(query.trim().toLowerCase());
	const filteredBoards = $derived(boards.filter((b) => b.name.toLowerCase().includes(q)));
	const filteredNew = $derived(NEW_ITEM.filter((n) => n.label.toLowerCase().includes(q)));

	type Entry = { key: string; section: string; label: string; sub?: string; run: () => void };
	const entries = $derived.by<Entry[]>(() => {
		const out: Entry[] = [];
		for (const b of filteredBoards) out.push({ key: `b:${b.id}`, section: 'Boards', label: b.name, sub: `${b.item_count} items`, run: () => onselectboard(b.id) });
		for (const n of filteredNew) out.push({ key: `n:${n.kind}`, section: 'Create', label: n.label, run: () => onnewitem(n.kind) });
		const actions: Entry[] = [
			{ key: 'a:fit', section: 'Actions', label: 'Fit view', sub: 'f', run: onfitview },
			{ key: 'a:export', section: 'Actions', label: 'Export board to markdown', run: onexport },
			{ key: 'a:theme', section: 'Actions', label: 'Toggle light/dark theme', run: onthemetoggle },
			{ key: 'a:newboard', section: 'Actions', label: 'New board', run: onnewboard }
		];
		for (const a of q.length >= 2 ? actions.filter((a) => a.label.toLowerCase().includes(q)) : actions) out.push(a);
		for (const h of hits) out.push({ key: `h:${h.source}:${h.id}`, section: 'Results', label: h.title, sub: h.source, run: () => onfocusitem(h) });
		return out;
	});

	function pick(e: Entry) {
		open = false;
		query = '';
		hits = [];
		e.run();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			active = Math.min(active + 1, entries.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			active = Math.max(active - 1, 0);
		} else if (e.key === 'Enter' && entries[active]) {
			e.preventDefault();
			pick(entries[active]);
		} else if (e.key === 'Escape') {
			open = false;
			inputEl?.blur();
		}
	}

	$effect(() => {
		function onGlobalKey(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
				e.preventDefault();
				open = !open;
				if (open) {
					query = '';
					hits = [];
					active = 0;
				}
			}
		}
		function onDocMouseDown(e: MouseEvent) {
			const t = e.target as Element | null;
			if (open && t && !t.closest('.cmd')) open = false;
		}
		window.addEventListener('keydown', onGlobalKey);
		document.addEventListener('mousedown', onDocMouseDown);
		return () => {
			window.removeEventListener('keydown', onGlobalKey);
			document.removeEventListener('mousedown', onDocMouseDown);
		};
	});

	$effect(() => {
		if (active < entries.length) {
			const el = document.querySelector('.cmd .hit.active');
			el?.scrollIntoView({ block: 'nearest' });
		}
	});

	$effect(() => {
		if (open) inputEl?.focus();
	});
</script>

<button class="cmd-trigger" onclick={() => (open = true)} aria-label="Open command palette (Ctrl+K)">
	<span>Search</span>
	<span class="kbd">⌘K</span>
</button>

{#if open}
	<div class="cmd-backdrop" onmousedown={() => (open = false)}></div>
	<div class="cmd" role="dialog" aria-label="Command palette">
		<input bind:this={inputEl} bind:value={query} placeholder="Type a command or search…" aria-label="Command palette input" onkeydown={handleKeydown} />
		<div class="cmd-results" role="listbox">
			{#each entries as e, i (e.key)}
				{#if i === 0 || entries[i - 1].section !== e.section}
					<span class="section">{e.section}</span>
				{/if}
				<button class="hit" class:active={i === active} role="option" aria-selected={i === active} onmousedown={(ev) => { ev.preventDefault(); pick(e); }}>
					<span class="body">
						<span class="title">{e.label}</span>
						{#if e.sub}<span class="sub">{e.sub}</span>{/if}
					</span>
				</button>
			{/each}
			{#if entries.length === 0}
				<span class="none">No matches</span>
			{/if}
		</div>
	</div>
{/if}

<style>
	.cmd-trigger {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		background: var(--bg-raise);
		border: 1px solid var(--border);
		border-radius: 8px;
		font-size: 13px;
		color: var(--text-dim);
		width: 200px;
		justify-content: space-between;
	}
	.cmd-trigger:hover {
		border-color: var(--accent);
		color: var(--text);
	}
	.kbd {
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		background: var(--bg-raise-2);
		border: 1px solid var(--border);
		border-radius: 5px;
		padding: 1px 5px;
		color: var(--text-dim);
	}
	.cmd-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.3);
		z-index: 90;
	}
	.cmd {
		position: fixed;
		top: 18%;
		left: 50%;
		transform: translateX(-50%);
		width: 560px;
		max-width: 90vw;
		z-index: 91;
		background: var(--bg-raise);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-3);
		overflow: hidden;
		animation: bb-pop-in var(--t-med) var(--ease-out);
	}
	.cmd input {
		width: 100%;
		border: none;
		border-bottom: 1px solid var(--border-soft);
		border-radius: 0;
		background: transparent;
		padding: 14px 16px;
		font-size: 15px;
	}
	.cmd-results {
		max-height: 420px;
		overflow-y: auto;
		padding: 6px;
	}
	.section {
		display: block;
		font-family: var(--font-display);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--text-dim);
		padding: 8px 10px 4px;
	}
	.hit {
		display: flex;
		align-items: center;
		width: 100%;
		padding: 8px 10px;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		text-align: left;
		cursor: pointer;
	}
	.hit.active {
		background: var(--accent-soft);
	}
	.body {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}
	.title {
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sub {
		font-size: 11px;
		color: var(--text-dim);
	}
	.none {
		display: block;
		padding: 12px 10px;
		font-size: 13px;
		color: var(--text-dim);
	}
</style>
