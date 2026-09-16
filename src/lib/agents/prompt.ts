import { buildBrief } from '../digest.js';
import { getItem, getConceptForItem } from '../store.js';
import type { Item } from '../db.js';

/**
 * Assemble a subagent prompt from an item + its context.
 * The brief keeps orientation compact; the item carries the actual work.
 */
export function buildPrompt(item: Item, extra?: string): string {
	const parent = item.parent_id ? getItem(item.parent_id) : null;
	const concept = item.kind === 'concept' ? getConceptForItem(item.id) : null;

	const parts: string[] = [
		'You are a subagent working inside "buildboard", a planning whiteboard shared between a user and their AI assistant. Your job is to expand the item below into a detailed, actionable definition. Be concrete and structured; avoid fluff.',
		'',
		'## Board context (brief)',
		buildBrief({ board_id: item.board_id }),
		'',
		'## Parent item',
		parent
			? `- ${parent.title} (${parent.kind}, ${parent.status})\n${parent.body_md}`
			: '(none — this item has no parent)',
		''
	];

	if (concept) {
		parts.push(
			'## Existing concept record',
			`- ${concept.name}: ${concept.definition}`,
			concept.details_md,
			''
		);
	}

	parts.push(
		'## Item to expand',
		`- Title: ${item.title}`,
		`- Kind: ${item.kind}`,
		`- Status: ${item.status}`,
		`- Tags: ${item.tags.join(', ') || '(none)'}`,
		`- Current body:\n${item.body_md || '(empty)'}`,
		''
	);

	if (extra) {
		parts.push('## Additional instructions', extra, '');
	}

	parts.push(
		'## Output',
		'Produce a complete markdown document for this item. Structure it with clear sections appropriate to its kind. End with a final section titled "Summary" of at most 3 sentences that captures the essence of the expanded item.'
	);

	return parts.join('\n');
}
