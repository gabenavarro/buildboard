import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

describe('repo root resolution', () => {
	afterEach(() => {
		delete process.env.BUILDBOARD_DB;
		delete process.env.BUILDBOARD_AGENT_DIR;
	});

	it('resolves the buildboard repo root from the module location', async () => {
		const { repoRoot, findRepoRoot } = await import('./db.js');
		const here = import.meta.dirname;
		const root = findRepoRoot(here);
		expect(root).toBe(path.resolve(here, '..', '..'));
		expect(existsSync(path.join(root, 'package.json'))).toBe(true);
		expect(repoRoot()).toBe(root);
	});

	it('walks up from a nested temp directory to the nearest package.json', async () => {
		const { findRepoRoot } = await import('./db.js');
		const tmp = mkdtempSync(path.join(tmpdir(), 'buildboard-root-'));
		try {
			const nested = path.join(tmp, 'a', 'b');
			mkdirSync(nested, { recursive: true });
			writeFileSync(path.join(tmp, 'package.json'), '{}');
			expect(findRepoRoot(nested)).toBe(tmp);
			// a package.json in an intermediate dir wins over the outer one
			writeFileSync(path.join(tmp, 'a', 'package.json'), '{}');
			expect(findRepoRoot(nested)).toBe(path.join(tmp, 'a'));
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it('defaults dbPath to <root>/data/buildboard.db and honors BUILDBOARD_DB', async () => {
		const { repoRoot, dbPath } = await import('./db.js');
		delete process.env.BUILDBOARD_DB;
		expect(dbPath()).toBe(path.join(repoRoot(), 'data', 'buildboard.db'));
		process.env.BUILDBOARD_DB = '/tmp/custom.db';
		expect(dbPath()).toBe('/tmp/custom.db');
	});

	it('defaults agentDir to the repo root and honors BUILDBOARD_AGENT_DIR', async () => {
		const { repoRoot } = await import('./db.js');
		const { agentDir } = await import('./agents/runner.js');
		delete process.env.BUILDBOARD_AGENT_DIR;
		expect(agentDir()).toBe(repoRoot());
		process.env.BUILDBOARD_AGENT_DIR = '/tmp/agents';
		expect(agentDir()).toBe('/tmp/agents');
	});
});
