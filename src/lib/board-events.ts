/**
 * In-process pub/sub for live board updates. Store mutations emit a change
 * for the affected board; the board SSE endpoint tails it so the canvas can
 * refresh without a reload (and without the client polling a full list).
 * Deliberately minimal: one shared process, so a plain in-memory bus is enough.
 */
type Listener = (payload: { board_id: string; type: string }) => void;

const listeners = new Map<string, Set<Listener>>();

export function emitBoardChange(board_id: string, type: string): void {
	const set = listeners.get(board_id);
	if (!set) return;
	for (const l of set) {
		try {
			l({ board_id, type });
		} catch {
			// a broken listener must not break the mutation
		}
	}
}

/** Subscribe to a board's changes; returns an unsubscribe function. */
export function onBoardChange(board_id: string, listener: Listener): () => void {
	let set = listeners.get(board_id);
	if (!set) {
		set = new Set();
		listeners.set(board_id, set);
	}
	set.add(listener);
	return () => {
		set.delete(listener);
		if (set.size === 0) listeners.delete(board_id);
	};
}
