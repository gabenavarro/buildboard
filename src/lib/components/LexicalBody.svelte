<script lang="ts">
	import { onMount } from 'svelte';
	import {
		createEditor,
		TextNode,
		$createParagraphNode as createParagraphNode,
		$getNodeByKey as getNodeByKey,
		$getRoot as getRoot,
		$getSelection as getSelection,
		$isRangeSelection as isRangeSelection,
		FORMAT_TEXT_COMMAND,
		SELECTION_CHANGE_COMMAND,
		COMMAND_PRIORITY_LOW,
		type LexicalEditor,
		type TextFormatType,
		type ElementNode,
		type NodeKey
	} from 'lexical';
	import {
		HeadingNode,
		QuoteNode,
		registerRichText,
		$createHeadingNode as createHeadingNode,
		$createQuoteNode as createQuoteNode,
		$isHeadingNode as isHeadingNode,
		$isQuoteNode as isQuoteNode
	} from '@lexical/rich-text';
	import {
		ListNode,
		ListItemNode,
		$createListNode as createListNode,
		$createListItemNode as createListItemNode,
		$isListNode as isListNode
	} from '@lexical/list';
	import { CodeNode, CodeHighlightNode } from '@lexical/code';
	import { LinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';
	import {
		TableNode,
		TableRowNode,
		TableCellNode,
		TableCellHeaderStates,
		$createTableNode as createTableNode,
		$createTableRowNode as createTableRowNode,
		$createTableCellNode as createTableCellNode
	} from '@lexical/table';
	import { $getNearestBlockElementAncestorOrThrow as nearestBlock } from '@lexical/utils';
	import {
		TRANSFORMERS,
		$convertToMarkdownString as toMarkdown,
		$generateNodesFromMarkdownString as nodesFromMarkdown,
		registerMarkdownShortcuts
	} from '@lexical/markdown';

	let { value, onmarkdown }: { value: string; onmarkdown: (md: string) => void } = $props();

	let rootEl = $state<HTMLElement | null>(null);
	let editor = $state<LexicalEditor | null>(null);

	let active = $state({
		bold: false,
		italic: false,
		strikethrough: false,
		code: false,
		h1: false,
		h2: false,
		quote: false,
		ul: false,
		ol: false
	});

	let exportTimer: ReturnType<typeof setTimeout> | null = null;

	function updateActive() {
		if (!editor) return;
		editor.getEditorState().read(() => {
			const next = {
				bold: false,
				italic: false,
				strikethrough: false,
				code: false,
				h1: false,
				h2: false,
				quote: false,
				ul: false,
				ol: false
			};
			const sel = getSelection();
			if (sel && isRangeSelection(sel)) {
				const anchor = sel.anchor;
				if (anchor) {
					const text = getNodeByKey(anchor.key);
					if (text instanceof TextNode) {
						next.bold = text.hasFormat('bold');
						next.italic = text.hasFormat('italic');
						next.strikethrough = text.hasFormat('strikethrough');
						next.code = text.hasFormat('code');
					}
					const block = blockForKey(anchor.key);
					if (block) {
						if (isHeadingNode(block)) {
							next.h1 = block.getTag() === 'h1';
							next.h2 = block.getTag() === 'h2';
						} else if (isQuoteNode(block)) {
							next.quote = true;
						} else if (isListNode(block)) {
							next.ul = block.getTag() === 'ul';
							next.ol = block.getTag() === 'ol';
						}
					}
				}
			}
			active = next;
		});
	}

	function scheduleExport() {
		const ed = editor;
		if (!ed) return;
		if (exportTimer) clearTimeout(exportTimer);
		exportTimer = setTimeout(() => {
			exportTimer = null;
			let md = '';
			ed.update(() => {
				md = toMarkdown(TRANSFORMERS, getRoot(), true);
			});
			onmarkdown(md);
		}, 150);
	}

	function blockForKey(key: NodeKey): ElementNode | null {
		const n = getNodeByKey(key);
		if (!n) return null;
		return nearestBlock(n);
	}

	onMount(() => {
		const ed = createEditor({
			namespace: 'buildboard-body',
			nodes: [
				HeadingNode,
				QuoteNode,
				ListNode,
				ListItemNode,
				CodeNode,
				CodeHighlightNode,
				LinkNode,
				TableNode,
				TableRowNode,
				TableCellNode
			]
		});
		editor = ed;
		ed.setRootElement(rootEl as HTMLElement);
		ed.setEditable(true);
		ed.update(() => {
			const root = getRoot();
			root.clear();
			if (value.trim()) {
				for (const n of nodesFromMarkdown(value, TRANSFORMERS, true)) {
					root.append(n);
				}
			} else {
				root.append(createParagraphNode());
			}
		});
		registerRichText(ed);
		registerMarkdownShortcuts(ed);
		const offUpdate = ed.registerUpdateListener(() => scheduleExport());
		const offSelection = ed.registerCommand(SELECTION_CHANGE_COMMAND, () => {
			updateActive();
			return false;
		}, COMMAND_PRIORITY_LOW);
		updateActive();
		return () => {
			if (exportTimer) clearTimeout(exportTimer);
			offUpdate();
			offSelection();
			ed.setEditable(false);
			ed.setRootElement(null);
		};
	});

	function fmtText(fmt: TextFormatType) {
		editor?.dispatchCommand(FORMAT_TEXT_COMMAND, fmt);
	}

	function setBlockType(target: 'h1' | 'h2' | 'quote') {
		editor?.update(() => {
			const sel = getSelection();
			if (!sel || !isRangeSelection(sel)) return;
			const block = blockForKey(sel.anchor.key);
			if (!block) return;
			const isCurrent =
				(target === 'h1' && isHeadingNode(block) && block.getTag() === 'h1') ||
				(target === 'h2' && isHeadingNode(block) && block.getTag() === 'h2') ||
				(target === 'quote' && isQuoteNode(block));
			let newNode;
			if (isCurrent) newNode = createParagraphNode();
			else if (target === 'h1') newNode = createHeadingNode('h1');
			else if (target === 'h2') newNode = createHeadingNode('h2');
			else newNode = createQuoteNode();
			for (const child of block.getChildren()) newNode.append(child);
			block.insertAfter(newNode);
			block.remove();
		});
	}

	function toggleList(type: 'ul' | 'ol') {
		editor?.update(() => {
			const sel = getSelection();
			if (!sel || !isRangeSelection(sel)) return;
			let n = getNodeByKey(sel.anchor.key);
			let list: ListNode | null = null;
			while (n) {
				if (isListNode(n)) {
					list = n;
					break;
				}
				n = n.getParent();
			}
			if (list) {
				for (const item of list.getChildren()) {
					for (const child of (item as ElementNode).getChildren()) {
						list.insertBefore(child);
					}
				}
				list.remove();
				return;
			}
			const block = blockForKey(sel.anchor.key);
			if (!block) return;
			const newList = createListNode(type === 'ol' ? 'number' : 'bullet');
			const item = createListItemNode();
			block.insertAfter(newList);
			item.append(block);
			newList.append(item);
		});
	}

	function insertTable() {
		editor?.update(() => {
			const table = createTableNode();
			for (let r = 0; r < 3; r++) {
				const row = createTableRowNode();
				for (let c = 0; c < 3; c++) {
					row.append(createTableCellNode(r === 0 ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS));
				}
				table.append(row);
			}
			const sel = getSelection();
			if (sel && isRangeSelection(sel)) {
				const block = blockForKey(sel.anchor.key);
				if (block) {
					block.insertAfter(table);
					return;
				}
			}
			getRoot().append(table);
		});
	}

	function toggleLink() {
		const url = window.prompt('Link URL', 'https://');
		if (url === null) return;
		editor?.dispatchCommand(TOGGLE_LINK_COMMAND, url);
	}
</script>

<div class="lex">
	<div class="toolbar" role="toolbar" aria-label="Formatting">
		<button type="button" class="tbtn" class:is-active={active.h1} title="Heading 1" onclick={() => setBlockType('h1')}>H1</button>
		<button type="button" class="tbtn" class:is-active={active.h2} title="Heading 2" onclick={() => setBlockType('h2')}>H2</button>
		<button type="button" class="tbtn" class:is-active={active.bold} title="Bold (Mod+B)" onclick={() => fmtText('bold')}><b>B</b></button>
		<button type="button" class="tbtn" class:is-active={active.italic} title="Italic (Mod+I)" onclick={() => fmtText('italic')}><i>I</i></button>
		<button type="button" class="tbtn" class:is-active={active.strikethrough} title="Strikethrough" onclick={() => fmtText('strikethrough')}><s>S</s></button>
		<button type="button" class="tbtn" class:is-active={active.code} title="Inline code" onclick={() => fmtText('code')}><span class="mono">code</span></button>
		<button type="button" class="tbtn" class:is-active={active.quote} title="Quote" onclick={() => setBlockType('quote')}>❝</button>
		<button type="button" class="tbtn" class:is-active={active.ul} title="Bullet list" onclick={() => toggleList('ul')}>• List</button>
		<button type="button" class="tbtn" class:is-active={active.ol} title="Numbered list" onclick={() => toggleList('ol')}>1. List</button>
		<button type="button" class="tbtn" title="Insert table" onclick={insertTable}>Table</button>
		<button type="button" class="tbtn" title="Insert link" onclick={toggleLink}>Link</button>
	</div>
	<div class="lex-root" bind:this={rootEl} contenteditable="true" role="textbox" aria-label="Body editor"></div>
</div>

<style>
	.lex {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-height: 160px;
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.tbtn {
		padding: 3px 8px;
		font-size: 12px;
		line-height: 1.2;
		border-radius: var(--radius-sm);
		background: var(--bg);
		color: var(--text-dim);
		border: 1px solid var(--border);
	}
	.tbtn:hover {
		color: var(--text);
	}
	.tbtn.is-active {
		background: var(--accent-soft);
		border-color: var(--accent);
		color: var(--accent);
	}
	.mono {
		font-family: var(--font-mono);
		font-size: 10px;
	}
	.lex-root {
		flex: 1;
		min-height: 140px;
		padding: 10px 12px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		font-size: 13px;
		line-height: 1.55;
		overflow-y: auto;
		outline: none;
	}
	.lex-root:focus {
		border-color: var(--accent);
	}
	.lex-root > * + * {
		margin-top: 8px;
	}
	.lex-root h1 {
		font-size: 18px;
		font-weight: 600;
		margin: 0;
	}
	.lex-root h2 {
		font-size: 16px;
		font-weight: 600;
		margin: 0;
	}
	.lex-root blockquote {
		margin: 0;
		padding: 2px 12px;
		border-left: 3px solid var(--border);
		color: var(--text-dim);
	}
	.lex-root ul,
	.lex-root ol {
		margin: 0;
		padding-left: 22px;
	}
	.lex-root code {
		font-family: var(--font-mono);
		font-size: 12px;
		background: var(--bg-raise-2);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 1px 5px;
	}
	.lex-root pre {
		background: var(--bg-raise-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 10px 12px;
		overflow-x: auto;
	}
	.lex-root pre code {
		background: none;
		border: none;
		padding: 0;
	}
	.lex-root a {
		color: var(--accent);
		text-decoration: underline;
	}
	.lex-root table {
		border-collapse: collapse;
		width: 100%;
		font-size: 12px;
	}
	.lex-root th,
	.lex-root td {
		border: 1px solid var(--border);
		padding: 5px 8px;
		text-align: left;
	}
	.lex-root th {
		background: var(--bg-raise-2);
		font-weight: 600;
	}
</style>
