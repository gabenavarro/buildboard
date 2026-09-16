import type { RequestHandler } from '@sveltejs/kit';
import { renameBoard, deleteBoard } from '$lib/store.js';
import { json, badRequest, notFound, readJson } from '../../_util.js';

type Params = { id: string };

export const PATCH: RequestHandler<Params> = async ({ request, params }) => {
	const body = await readJson(request);
	if (typeof body.name !== 'string' || body.name.trim() === '') {
		return badRequest('name is required');
	}
	const board = renameBoard(params.id, body.name.trim());
	if (!board) return notFound('board not found');
	return json(board);
};

export const DELETE: RequestHandler<Params> = async ({ params }) => {
	const deleted = deleteBoard(params.id);
	if (!deleted) return badRequest('board not found or not empty');
	return json({ ok: true });
};
