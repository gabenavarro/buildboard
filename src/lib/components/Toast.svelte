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
		bottom: 18px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		z-index: 100;
		pointer-events: none;
	}
	.toast {
		display: flex;
		align-items: center;
		gap: 8px;
		max-width: 340px;
		padding: 8px 14px;
		font-size: 13px;
		background: var(--glass-strong);
		backdrop-filter: var(--glass-blur);
		-webkit-backdrop-filter: var(--glass-blur);
		border: 1px solid var(--border-soft);
		border-radius: 999px;
		box-shadow: var(--shadow-3);
		animation: bb-toast-in var(--t-med) var(--ease-out);
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
