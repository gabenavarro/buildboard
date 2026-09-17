<script lang="ts">
	import { api } from '$lib/api.js';
	import type { SearchHit, Board } from '$lib/types.js';

	let {
		boardId,
		boards,
		onselect
	}: { boardId: string; boards: Board[]; onselect: (hit: SearchHit) => void } = $props();

	let inputEl = $state<HTMLInputElement | null>(null);
	let query = $state('');
	let hits = $state<SearchHit[]>([]);
	let open = $state(false);
	let active = $state(-1);

	$effect(() => {
		const q = query.trim();
		if (q.length < 2) {
			hits = [];
			open = false;
			active = -1;
			return;
		}
		const timer = setTimeout(async () => {
			try {
				const res = await api.search(q, boardId);
				// ignore stale responses (the effect re-runs on every keystroke)
				if (query.trim() !== q) return;
				hits = res.hits;
				open = hits.length > 0;
				active = hits.length > 0 ? 0 : -1;
			} catch {
				// search failures are non-fatal
			}
		}, 200);
		return () => clearTimeout(timer);
	});

	function boardName(id: string | null): string | null {
		if (!id || id === boardId) return null;
		return boards.find((b) => b.id === id)?.name ?? null;
	}

	function pick(hit: SearchHit) {
		open = false;
		query = '';
		hits = [];
		active = -1;
		onselect(hit);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (hits.length) active = Math.min(active + 1, hits.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			active = Math.max(active - 1, 0);
		} else if (e.key === 'Enter' && active >= 0 && hits[active]) {
			e.preventDefault();
			pick(hits[active]);
		} else if (e.key === 'Escape') {
			open = false;
			inputEl?.blur();
		}
	}

	$effect(() => {
		function onGlobalKey(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
				e.preventDefault();
				inputEl?.focus();
				inputEl?.select();
			}
		}
		function onDocMouseDown(e: MouseEvent) {
			const t = e.target as Element | null;
			if (t && !t.closest('.searchbox')) open = false;
		}
		window.addEventListener('keydown', onGlobalKey);
		document.addEventListener('mousedown', onDocMouseDown);
		return () => {
			window.removeEventListener('keydown', onGlobalKey);
			document.removeEventListener('mousedown', onDocMouseDown);
		};
	});
</script>

<div class="searchbox">
	<input
		bind:this={inputEl}
		bind:value={query}
		type="text"
		placeholder="Search…  (⌘K)"
		aria-label="Search board"
		onkeydown={handleKeydown}
	/>
	{#if open}
		<div class="results" role="listbox">
			{#each hits as hit, i (hit.source + hit.id)}
				<button
					class="hit"
					class:active={i === active}
					role="option"
					aria-selected={i === active}
					onmousedown={(e) => {
						e.preventDefault();
						pick(hit);
					}}
				>
					<span class="src src-{hit.source}">{hit.source}</span>
					<span class="body">
						<span class="title">{hit.title}</span>
						{#if hit.snippet}<span class="snippet">{hit.snippet}</span>{/if}
					</span>
					{#if boardName(hit.board_id)}
						<span class="boardtag">{boardName(hit.board_id)}</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.searchbox {
		position: relative;
		width: 300px;
	}
	.searchbox input {
		width: 100%;
		padding: 6px 10px;
		font-size: 13px;
	}
	.results {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		max-height: 420px;
		overflow-y: auto;
		background: var(--glass-strong);
		backdrop-filter: var(--glass-blur);
		-webkit-backdrop-filter: var(--glass-blur);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		box-shadow: var(--shadow-3);
		z-index: 50;
	}
	.hit {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 8px 10px;
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--border);
		text-align: left;
		cursor: pointer;
	}
	.hit:last-child {
		border-bottom: none;
	}
	.hit.active {
		background: var(--accent-soft);
	}
	.src {
		flex-shrink: 0;
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #0b0e14;
		border-radius: 4px;
		padding: 2px 5px;
	}
	.src-item {
		background: var(--kind-note, var(--accent));
	}
	.src-decision {
		background: var(--kind-decision, var(--accent));
	}
	.src-concept {
		background: var(--kind-concept, var(--accent));
	}
	.src-message {
		background: var(--kind-task, var(--accent));
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
	.snippet {
		font-size: 11px;
		color: var(--text-dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.boardtag {
		flex-shrink: 0;
		font-size: 10px;
		color: var(--text-dim);
	}
</style>
