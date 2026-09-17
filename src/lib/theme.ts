import { writable } from 'svelte/store';

export type Theme = 'dark' | 'light';

const KEY = 'buildboard:theme';

function initial(): Theme {
	if (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light') return 'light';
	try {
		const s = localStorage.getItem(KEY);
		if (s === 'light' || s === 'dark') return s;
	} catch {
		/* expected */
	}
	return 'dark';
}

export const theme = writable<Theme>(initial());

/** @param {Theme} t */
export function applyTheme(t: Theme) {
	document.documentElement.dataset.theme = t;
	document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#f4f6fb' : '#0a0d14');
	try {
		localStorage.setItem(KEY, t);
	} catch {
		/* expected */
	}
}

export function toggleTheme() {
	const next: Theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
	applyTheme(next);
	theme.set(next);
}
