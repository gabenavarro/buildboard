// Visual verification loop (Playwright). NOT run in CI.
// Boots vite dev on a temp port with a throwaway DB and asserts the design
// system actually renders: bundled fonts, glass surfaces, film grain, WCAG
// contrast, node elevation, ambient glow, empty state. Captures a screenshot
// for human review at /tmp/opencode/shots/. Exits non-zero on failure.
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4322;
const BASE = `http://localhost:${PORT}`;
const SHOTS = '/tmp/opencode/shots';

const watchdog = setTimeout(() => {
  console.error('FAIL: visual watchdog timeout (120s)');
  process.exit(2);
}, 120000);
watchdog.unref?.();

const dbDir = mkdtempSync(path.join(tmpdir(), 'buildboard-visual-'));
const dbFile = path.join(dbDir, 'visual.db');

/** @type {import('node:child_process').ChildProcess | null} */
let child = null;
/** @type {import('playwright').Browser | null} */
let browser = null;

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch { /* expected */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('dev server did not start in time');
}

/** @param {string} title @param {string} kind @param {number} x @param {number} y */
async function apiCreateItem(title, kind, x, y) {
  const res = await fetch(`${BASE}/api/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, kind, x, y, board_id: 'default' })
  });
  if (!res.ok) throw new Error(`POST /api/items failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** @param {string} label @param {boolean} cond @param {string} [detail] */
function check(label, cond, detail = '') {
  if (!cond) {
    console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
    process.exitCode = 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

/**
 * WCAG relative-luminance contrast ratio, evaluated in-page.
 * @param {import('playwright').Page} page
 * @param {string} fgSelector
 * @param {string} bgSelector
 */
async function contrastRatio(page, fgSelector, bgSelector) {
  return page.evaluate(
    ([fgSel, bgSel]) => {
      /** @param {string} rgb */
      const lum = (rgb) => {
        /** @param {string} v */
        const chan = (v) => {
          const c = Number(v) / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        const [r, g, b] = rgb.replace('rgb(', '').replace(')', '').split(',').map(chan);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      /** @param {string} sel */
      const css = (sel) => getComputedStyle(/** @type {HTMLElement} */ (document.querySelector(sel)));
      const fg = lum(css(fgSel).color);
      const bg = lum(css(bgSel).backgroundColor);
      const [hi, lo] = fg > bg ? [fg, bg] : [bg, fg];
      return (hi + 0.05) / (lo + 0.05);
    },
    [fgSelector, bgSelector]
  );
}

try {
  execSync(`pkill -9 -f "vite dev --port \${PORT} --strict[P]ort" || true`);

  child = spawn('npx', ['vite', 'dev', '--port', String(PORT), '--strictPort'], {
    cwd: repoRoot,
    env: { ...process.env, BUILDBOARD_DB: dbFile },
    stdio: 'ignore',
    detached: true
  });

  await waitForServer();

  await apiCreateItem('Visual Alpha', 'note', 60, 60);
  await apiCreateItem('Visual Beta', 'decision', 360, 60);

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  /** @type {string[]} */
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.svelte-flow', { timeout: 10000 });
  await page.waitForTimeout(900);

  check('no page errors', pageErrors.length === 0, pageErrors[0]?.slice(0, 160));

  // Bundled variable fonts are actually loaded.
  const fontsOk = await page.evaluate(() => {
    document.fonts.ready.then(() => {});
    return (
      document.fonts.check('16px "Inter Variable"') && document.fonts.check('16px "Space Grotesk Variable"')
    );
  });
  check('bundled fonts loaded (Inter + Space Grotesk)', fontsOk);

  // Glass on the topbar.
  const topbarBlur = await page.locator('.topbar').evaluate((el) => getComputedStyle(el).backdropFilter);
  check('topbar uses glass backdrop-filter', /blur/.test(topbarBlur), topbarBlur);

  // Film-grain overlay on body::after.
  const grain = await page.evaluate(() => getComputedStyle(document.body, '::after').backgroundImage);
  check('grain overlay present', grain !== 'none' && grain.includes('svg'), grain.slice(0, 40));

  // WCAG contrast: brand text vs page background (>= 4.5:1 for normal text).
  const ratio = await contrastRatio(page, '.brand', 'body');
  check('topbar text contrast >= 4.5:1', ratio >= 4.5, `ratio=${ratio.toFixed(2)}`);

  // Node elevation: layered shadow (not flat/none).
  const shadow = await page.locator('.svelte-flow__node .card').first().evaluate((el) => getComputedStyle(el).boxShadow);
  check('node card has layered shadow', shadow !== 'none' && shadow.length > 10, shadow.slice(0, 40));

  // Ambient glow behind the canvas.
  const glow = await page.evaluate(() =>
    getComputedStyle(/** @type {HTMLElement} */ (document.querySelector('.board')), '::before').background
  );
  check('ambient glow present on canvas', glow !== 'none' && glow.length > 0, glow.slice(0, 40));

  // Hover: node card responds (transition on box-shadow/border is declared).
  const card = page.locator('.svelte-flow__node .card').first();
  /** @param {Element | null} el */
  const shadowOf = (el) => getComputedStyle(/** @type {HTMLElement} */ (el)).boxShadow;
  const before = await card.evaluate(shadowOf);
  await card.hover();
  await page.waitForTimeout(250);
  const after = await card.evaluate(shadowOf);
  check('node hover changes elevation', before !== after, 'no change');

  // Screenshot for human review.
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, 'u9-dark.png') });
  console.log(`screenshot: ${path.join(SHOTS, 'u9-dark.png')}`);

  // Motion: node entrance animation is declared on cards.
  const anim = await card.evaluate((el) => getComputedStyle(el).animationName);
  check('node entrance animation declared', anim !== 'none', anim);

  // Feedback: creating an item via the palette surfaces a toast.
  await page.locator('.palette > button').click();
  await page.locator('.palette li button', { hasText: 'Note' }).click();
  await page.waitForTimeout(500);
  check('toast appears after create', (await page.locator('.toast').count()) >= 1);

  // Command palette opens on Ctrl+K.
  await page.keyboard.press('Control+KeyK');
  await page.waitForTimeout(400);
  check('command palette opens', (await page.locator('.cmd').count()) === 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Theme toggle: switches to light and updates the root.
  await page.locator('.boards button[aria-label="Toggle light/dark theme"]').click();
  await page.waitForTimeout(800);
  const lightRoot = await page.evaluate(() => document.documentElement.dataset.theme);
  const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('theme switches to light', lightRoot === 'light', lightRoot);
  check('light background applied', lightBg.startsWith('rgb(244') || lightBg.startsWith('rgba(244'), lightBg);
  await page.screenshot({ path: path.join(SHOTS, 'u11-light.png') });
  console.log(`screenshot: ${path.join(SHOTS, 'u11-light.png')}`);
  await page.locator('.boards button[aria-label="Toggle light/dark theme"]').click();
  await page.waitForTimeout(800);

  // Empty state: switch to a fresh empty board.
  await (await fetch(BASE + '/api/boards', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Visual Empty' })
  })).json();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.svelte-flow', { timeout: 10000 });
  await page.locator('select').first().selectOption({ label: 'Visual Empty (0)' });
  await page.waitForTimeout(900);
  check('empty state card renders', (await page.locator('.empty-card').count()) === 1);
  await page.screenshot({ path: path.join(SHOTS, 'u9-empty.png') });
  console.log(`screenshot: ${path.join(SHOTS, 'u9-empty.png')}`);

  clearTimeout(watchdog);
  if (process.exitCode === 0) console.log('\nVISUAL PASS');
} catch (e) {
  console.error(`FAIL: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (child) {
    const proc = child;
    /** @param {number | 'SIGTERM' | 'SIGKILL'} sig */
    const killGroup = (sig) => {
      try {
        if (proc.pid) process.kill(-proc.pid, sig);
      } catch {
        try {
          proc.kill(sig);
        } catch { /* expected */ }
      }
    };
    killGroup('SIGTERM');
    setTimeout(() => killGroup('SIGKILL'), 2000).unref();
  }
  clearTimeout(watchdog);
  try {
    execSync(`pkill -9 -f "vite dev --port \${PORT} --strict[P]ort" || true`);
  } catch { /* expected */ }
  rmSync(dbDir, { recursive: true, force: true });
}
