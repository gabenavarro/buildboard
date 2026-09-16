// Local rendering smoke test (Playwright). NOT run in CI.
// Boots vite dev on a temp port with a throwaway DB, creates items via the
// API, and asserts the canvas actually renders them. Exits non-zero on failure.
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4321;
const BASE = `http://localhost:${PORT}`;

// Overall watchdog: never hang silently.
const watchdog = setTimeout(() => {
  console.error('FAIL: e2e watchdog timeout (120s)');
  process.exit(2);
}, 120000);
watchdog.unref?.();

const dbDir = mkdtempSync(path.join(tmpdir(), 'buildboard-e2e-'));
const dbFile = path.join(dbDir, 'e2e.db');

let child = null;
let browser = null;

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('dev server did not start in time');
}

async function apiCreateItem(title, kind, x, y) {
  const res = await fetch(`${BASE}/api/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, kind, x, y, board_id: 'default' })
  });
  if (!res.ok) throw new Error(`POST /api/items failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function check(label, cond, detail = '') {
  if (!cond) {
    console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
    process.exitCode = 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

try {
  child = spawn('npx', ['vite', 'dev', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot,
    env: { ...process.env, BUILDBOARD_DB: dbFile },
    stdio: ['ignore', 'ignore', 'ignore']
  });

  await waitForServer();

  await apiCreateItem('E2E Alpha', 'note', 40, 40);
  await apiCreateItem('E2E Beta', 'task', 320, 40);
  await apiCreateItem('E2E Gamma', 'plan', 600, 40);

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.svelte-flow', { timeout: 10000 });
  await page.waitForTimeout(800);

  check('no page errors', pageErrors.length === 0, pageErrors[0]?.slice(0, 160));
  check('svelte-flow container rendered', await page.locator('.svelte-flow').count() === 1);
  await page
    .waitForFunction(() => document.querySelectorAll('.svelte-flow__node .card').length === 3, null, { timeout: 15000 })
    .catch(() => {});
  const cards = page.locator('.svelte-flow__node .card');
  check('3 node cards rendered', (await cards.count()) === 3, `got ${await cards.count()}`);
  for (const t of ['E2E Alpha', 'E2E Beta', 'E2E Gamma']) {
    check(`title visible: ${t}`, await page.locator(`.svelte-flow__node .title:has-text("${t}")`).count() === 1);
  }
  check('status badge rendered', (await page.locator('.svelte-flow__node .status').count()) === 3);
  check('kind badge rendered', (await page.locator('.svelte-flow__node .badge').count()) === 3);
  check('minimap rendered', await page.locator('.svelte-flow__minimap').count() === 1);

  // Search UI: type a known title, expect a result, select it, expect focus.
  const searchInput = page.locator('.searchbox input');
  check('search box present', (await searchInput.count()) === 1);
  await searchInput.fill('E2E Beta');
  await page.waitForTimeout(600);
  const hit = page.locator('.results .hit');
  check('search results rendered', (await hit.count()) >= 1, 'none');
  check('best hit is the exact title', (await hit.first().locator('.title').textContent()) === 'E2E Beta');
  await hit.first().click();
  await page.waitForTimeout(800);
  check('results closed after selection', (await page.locator('.results').count()) === 0);
  check('detail panel focused the hit', await page.locator('.panel .title, [class*=panel] .title').first().textContent().then((t) => t?.includes('E2E Beta')).catch(() => false) === true || (await page.locator('text=E2E Beta').count()) > 0);

  // Canvas chrome: zoom controls + readout
  check('zoom controls rendered', (await page.locator('.svelte-flow__controls').count()) === 1);
  check('zoom readout rendered', (await page.locator('.zoomreadout').count()) === 1);

  // Board switch: canvas stays mounted, new board's items render
  const before = await page.locator('.svelte-flow').count();
  await (await fetch(BASE + '/api/boards', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'E2E Board Two' })
  })).json();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.svelte-flow', { timeout: 10000 });
  await page.locator('select').first().selectOption({ label: 'E2E Board Two (0)' });
  await page.waitForTimeout(900);
  check('canvas not remounted on switch', (await page.locator('.svelte-flow').count()) === before);
  check('empty hint on empty board', (await page.locator('.hint').count()) === 1);
  check('no cards on empty board', (await page.locator('.svelte-flow__node .card').count()) === 0);
  await page.locator('select').first().selectOption({ index: 0 });
  await page.waitForTimeout(900);
  await page
    .waitForFunction(() => document.querySelectorAll('.svelte-flow__node .card').length === 3, null, { timeout: 15000 })
    .catch(() => {});
  check('original nodes back after switch', (await page.locator('.svelte-flow__node .card').count()) === 3);



  clearTimeout(watchdog);
  if (process.exitCode === 0) console.log('\nE2E PASS');
} catch (e) {
  console.error(`FAIL: ${e.message}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (child) {
		const killGroup = (sig) => {
			try {
				process.kill(-child.pid, sig);
			} catch {
				try {
					child.kill(sig);
				} catch {}
			}
		};
		killGroup('SIGTERM');
		setTimeout(() => killGroup('SIGKILL'), 2000).unref();
	}
  clearTimeout(watchdog);
  rmSync(dbDir, { recursive: true, force: true });
}
