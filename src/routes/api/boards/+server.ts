import type { RequestHandler } from '@sveltejs/kit';
import { listBoards, createBoard } from '$lib/store.js';
import { json, badRequest, readJson } from '../_util.js';

export const GET: RequestHandler = async () => {
	return json(listBoards());
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await readJson(request);
	if (typeof body.name !== 'string' || body.name.trim() === '') {
		return badRequest('name is required');
	}
	return json(createBoard(body.name.trim()), 201);
};
