import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { dbPath, repoRoot } from '../src/lib/db.ts';

/**
 * db:reset / db:backup for the dev database.
 *
 * db:backup is a straight file copy of buildboard.db (+ -wal / -shm sidecars).
 * That is safe only when no writer is active (e.g. dev server stopped); a
 * copy taken mid-write can capture a torn WAL state. For online backups use
 * the node:sqlite backup API instead.
 */

function stamp() {
	const d = new Date();
	/** @param {number} n */
	const p = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function dbFiles() {
	const base = dbPath();
	return [base, `${base}-wal`, `${base}-shm`].filter((f) => existsSync(f));
}

const command = process.argv[2];

if (command === 'reset') {
	const files = dbFiles();
	if (files.length === 0) {
		console.log(`nothing to remove (no database files at ${dbPath()})`);
	} else {
		for (const f of files) {
			rmSync(f);
			console.log(`removed ${path.relative(repoRoot(), f)}`);
		}
	}
} else if (command === 'backup') {
	const files = dbFiles();
	if (files.length === 0) {
		console.error(`nothing to back up (no database files at ${dbPath()})`);
		process.exit(1);
	}
	const dir = path.join(path.dirname(dbPath()), 'backups');
	mkdirSync(dir, { recursive: true });
	const suffix = stamp();
	for (const f of files) {
		const m = path.basename(f).match(/^(.*?)(\.db)(.*)$/);
		const dest = m ? path.join(dir, `${m[1]}-${suffix}.db${m[3]}`) : path.join(dir, `${path.basename(f)}-${suffix}`);
		copyFileSync(f, dest);
		console.log(`backed up ${path.relative(repoRoot(), f)} -> ${path.relative(repoRoot(), dest)}`);
	}
} else {
	console.error(`usage: node scripts/db.mjs <reset|backup>`);
	process.exit(1);
}
