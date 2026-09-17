import { writable } from 'svelte/store';

export type Theme = 'dark' | 'light';

const KEY = 'buildboard:theme';

function initial(): Theme {
	if (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark') return 'dark';
	try {
		const s = localStorage.getItem(KEY);
		if (s === 'light' || s === 'dark') return s;
	} catch {
		/* expected */
	}
	return 'light';
}

export const theme = writable<Theme>(initial());

/** @param {Theme} t */
export function applyTheme(t: Theme) {
	document.documentElement.dataset.theme = t;
	document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#f7f8fa' : '#16181d');
	try {
		localStorage.setItem(KEY, t);
	} catch {
		/* expected */
	}
}

export function toggleTheme() {
	const next: Theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
	applyTheme(next);
	theme.set(next);
}
