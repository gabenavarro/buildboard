<script lang="ts">
	import { toasts } from '$lib/toast.js';

	const ICONS = { success: '✓', error: '✕', info: '•' } as const;
</script>

<div class="toasts" aria-live="polite" aria-atomic="false">
	{#each $toasts as t (t.id)}
		<div class="toast t-{t.kind}">
			<span class="icon" aria-hidden="true">{ICONS[t.kind]}</span>
			<span class="msg">{t.message}</span>
		</div>
	{/each}
</div>

<style>
	.toasts {
		position: fixed;
		top: 14px;
		right: 14px;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 8px;
		z-index: 100;
		pointer-events: none;
	}
	.toast {
		display: flex;
		align-items: center;
		gap: 8px;
		max-width: 340px;
		padding: 7px 12px;
		font-size: 13px;
		background: var(--bg-raise);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-2);
		animation: bb-slide-in var(--t-med) var(--ease-out);
	}
	.icon {
		display: grid;
		place-items: center;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		font-size: 11px;
		flex-shrink: 0;
	}
	.t-success .icon {
		background: color-mix(in srgb, var(--kind-plan) 25%, transparent);
		color: var(--kind-plan);
	}
	.t-error .icon {
		background: color-mix(in srgb, var(--danger) 25%, transparent);
		color: var(--danger);
	}
	.t-info .icon {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.msg {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
