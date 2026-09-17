<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#f7f8fa" />
	<script>
		// Apply persisted theme before first paint (no flash). Light is the default.
		try {
			var t = localStorage.getItem('buildboard:theme');
			if (t === 'dark') document.documentElement.dataset.theme = t;
		} catch (e) {
			/* expected */
		}
	</script>
</svelte:head>

{@render children()}
