import { writable } from 'svelte/store';

export type ToastKind = 'success' | 'error' | 'info';
export type Toast = { id: number; kind: ToastKind; message: string };

export const toasts = writable<Toast[]>([]);

let nextId = 1;

/** @param {ToastKind} kind @param {string} message */
export function toast(kind: ToastKind, message: string) {
	const id = nextId++;
	toasts.update((list) => [...list, { id, kind, message }]);
	setTimeout(() => toasts.update((list) => list.filter((t) => t.id !== id)), 2400);
}
