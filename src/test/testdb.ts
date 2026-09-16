import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';

let tmpRoot: string | null = null;

function root(): string {
	if (!tmpRoot) tmpRoot = mkdtempSync(path.join(tmpdir(), 'buildboard-test-'));
	return tmpRoot;
}

/**
 * Point BUILDBOARD_DB at a fresh temp database and reset the module registry
 * so the store re-initializes against the new file. Returns the DB path.
 */
export function freshDb(): string {
	const dbFile = path.join(root(), `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
	process.env.BUILDBOARD_DB = dbFile;
	vi.resetModules();
	return dbFile;
}

/** Unset BUILDBOARD_DB. Call from afterEach. */
export function cleanupDb(): void {
	delete process.env.BUILDBOARD_DB;
}

/** Remove the temp dir created by freshDb. Call from afterAll. */
export function cleanupTempDirs(): void {
	if (tmpRoot) {
		rmSync(tmpRoot, { recursive: true, force: true });
		tmpRoot = null;
	}
}
