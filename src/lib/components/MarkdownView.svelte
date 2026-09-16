<script lang="ts">
	import { marked } from 'marked';

	let { text }: { text: string } = $props();

	const html = $derived(marked.parse(text ?? '', { async: false }) as string);
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- trust model: local single-user app; content authored by the user or their own agents -->
<div class="md">{@html html}</div>
