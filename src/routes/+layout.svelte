<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#0a0d14" />
	<script>
		// Apply persisted theme before first paint (no flash).
		try {
			var t = localStorage.getItem('buildboard:theme');
			if (t === 'light') document.documentElement.dataset.theme = t;
		} catch (e) {
			/* expected */
		}
	</script>
</svelte:head>

{@render children()}
