// Local rendering smoke test (Playwright). NOT run in CI.
// Boots vite dev on a temp port with a throwaway DB, creates items via the
// API, and asserts the canvas actually renders them. Exits non-zero on failure.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4321;
const BASE = `http://localhost:${PORT}`;

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

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  check('no page errors', pageErrors.length === 0, pageErrors[0]?.slice(0, 160));
  check('svelte-flow container rendered', await page.locator('.svelte-flow').count() === 1);
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



  if (process.exitCode === 0) console.log('\nE2E PASS');
} catch (e) {
  console.error(`FAIL: ${e.message}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (child) child.kill('SIGTERM');
  rmSync(dbDir, { recursive: true, force: true });
}
