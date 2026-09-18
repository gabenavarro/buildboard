// Visual verification loop (Playwright). NOT run in CI.
// Boots vite dev on a temp port with a throwaway DB and asserts the calm
// design system renders: light-by-default, solid (non-glass) chrome, no
// film grain, no ambient glow, bundled Inter, node body preview, WCAG
// contrast, command palette, theme toggle. Captures screenshots for human
// review at /tmp/opencode/shots/. Exits non-zero on failure.
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

/** @param {string} title @param {string} kind @param {number} x @param {number} y @param {string} [body] */
async function apiCreateItem(title, kind, x, y, body = '') {
  const res = await fetch(`${BASE}/api/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, kind, x, y, body_md: body, board_id: 'default' })
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

  const va = await apiCreateItem('Visual Alpha', 'note', 60, 60, 'A calm note body for preview');
  const vb = await apiCreateItem('Visual Beta', 'decision', 360, 60);
  await apiCreateItem('Visual Label', 'text', 660, 60, 'a free text label');
  await fetch(`${BASE}/api/edges`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from_id: va.id, to_id: vb.id, kind: 'depends_on', label: 'depends on', board_id: 'default' })
  });

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  /** @type {string[]} */
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.svelte-flow', { timeout: 10000 });
  await page.waitForTimeout(900);

  check('no page errors', pageErrors.length === 0, pageErrors[0]?.slice(0, 160));

  // Default theme is light (no dark persisted on a fresh profile).
  const initialBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('light theme by default', initialBg === 'rgb(247, 248, 250)', initialBg);

  // Bundled Inter variable font is loaded.
  const fontsOk = await page.evaluate(() => document.fonts.check('16px "Inter Variable"'));
  check('bundled font loaded (Inter)', fontsOk);

  // Topbar is solid: no glass backdrop-filter, opaque background.
  const topbar = await page.locator('.topbar').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { blur: cs.backdropFilter, bg: cs.backgroundColor };
  });
  check('topbar is solid (no backdrop-filter)', topbar.blur === 'none', topbar.blur);
  check('topbar background opaque', !topbar.bg.startsWith('rgba(0, 0, 0, 0'), topbar.bg);

  // No film-grain overlay.
  const grain = await page.evaluate(() => getComputedStyle(document.body, '::after').backgroundImage);
  check('no grain overlay', grain === 'none', grain.slice(0, 40));

  // No ambient glow behind the canvas.
  const glow = await page.evaluate(() =>
    getComputedStyle(/** @type {HTMLElement} */ (document.querySelector('.board')), '::before').background
  );
  check('no ambient glow on canvas', !glow.includes('gradient'), glow.slice(0, 40));

  // WCAG contrast: brand text vs page background (>= 4.5:1 for normal text).
  const ratio = await contrastRatio(page, '.brand', 'body');
  check('topbar text contrast >= 4.5:1', ratio >= 4.5, `ratio=${ratio.toFixed(2)}`);

  // Node card: solid raised surface with a shadow.
  const card = page.locator('.svelte-flow__node .card').first();
  const shadow = await card.evaluate((el) => getComputedStyle(el).boxShadow);
  check('node card has shadow', shadow !== 'none', shadow.slice(0, 40));

  // Node body preview renders plain text.
  const preview = await card.locator('.preview').first().textContent().catch(() => '');
  check('node body preview renders', (preview || '').trim().length > 0, preview?.slice(0, 40));

  // Hover: node card responds (shadow changes).
  /** @param {Element | null} el */
  const shadowOf = (el) => getComputedStyle(/** @type {HTMLElement} */ (el)).boxShadow;
  const before = await card.evaluate(shadowOf);
  await card.hover();
  await page.waitForTimeout(250);
  const after = await card.evaluate(shadowOf);
  check('node hover changes elevation', before !== after, 'no change');

  // Handles: circular and hidden at rest (the "pixel block" cleanup, issue #74).
  // Move the mouse off the card so the node is no longer :hover.
  await page.mouse.move(5, 5);
  await page.waitForTimeout(250);
  const handle = page.locator('.svelte-flow__handle').first();
  const handleStyle = await handle.evaluate((el) => {
    const cs = getComputedStyle(/** @type {HTMLElement} */ (el));
    return { radius: cs.borderRadius, opacity: cs.opacity };
  });
  check('handles are circular', handleStyle.radius === '50%', handleStyle.radius);
  check('handles hidden at rest', handleStyle.opacity === '0', `opacity=${handleStyle.opacity}`);

  // Free-text label (issue #76): borderless chrome — transparent background, no card shadow.
  const textNode = page.locator('.svelte-flow__node .text').first();
  const textChrome = await textNode.evaluate((el) => {
    const cs = getComputedStyle(/** @type {HTMLElement} */ (el));
    return { bg: cs.backgroundColor, shadow: cs.boxShadow };
  });
  check('text label renders', (await textNode.count()) === 1, `count=${await textNode.count()}`);
  check('text label has transparent background', textChrome.bg === 'rgba(0, 0, 0, 0)', textChrome.bg);
  check('text label has no card shadow', textChrome.shadow === 'none', textChrome.shadow.slice(0, 30));

  // Phase 3 affordances (issue #78): delete button on selected card + edge editor.
  const alphaCard = page.locator('.svelte-flow__node .card', { hasText: 'Visual Alpha' }).first();
  await alphaCard.click();
  await page.waitForTimeout(200);
  const delVisible = await page.locator('.svelte-flow__node .card .del').count();
  check('delete button appears on selected card', delVisible >= 1, `count=${delVisible}`);

  const edgePath = page.locator('.svelte-flow__edge-path').first();
  await edgePath.click({ force: true });
  await page.waitForTimeout(200);
  const edgeEditor = page.locator('.edge-editor');
  check('edge editor opens on edge select', (await edgeEditor.count()) === 1, `count=${await edgeEditor.count()}`);

  // Edge-label text contrast (SVG fill vs page background) >= 4.5:1.
  const edgeLabelContrast = await page.evaluate(() => {
    const t = document.querySelector('.svelte-flow__edge-label');
    if (!t) return 0;
    const fill = getComputedStyle(t).color;
    const bg = getComputedStyle(document.body).backgroundColor;
    /** @param {string} rgb */
    const lum = (rgb) => {
      const [r, g, b] = rgb.replace('rgb(', '').replace(')', '').split(',').map((v) => {
        const c = Number(v) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const a = lum(fill);
    const b2 = lum(bg);
    const [hi, lo] = a > b2 ? [a, b2] : [b2, a];
    return (hi + 0.05) / (lo + 0.05);
  });
  check('edge label contrast >= 4.5:1', edgeLabelContrast >= 4.5, `ratio=${edgeLabelContrast.toFixed(2)}`);

  // Motion: node entrance animation is declared on cards.
  const anim = await card.evaluate((el) => getComputedStyle(el).animationName);
  check('node entrance animation declared', anim === 'bb-fade-in', anim);

  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, 'u12-light.png') });
  console.log(`screenshot: ${path.join(SHOTS, 'u12-light.png')}`);

  // Feedback: creating an item via the palette surfaces a toast (top-right).
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

  // Detail panel Lexical editor renders with a toolbar and accepts input.
  await page.locator('.svelte-flow__node .card').first().click();
  await page.waitForTimeout(500);
  check('lexical editor renders', (await page.locator('.panel .lex-root').count()) === 1);
  check('editor toolbar renders', (await page.locator('.panel .toolbar').count()) === 1);
  await page.locator('.panel .lex-root').click();
  await page.keyboard.type('Visual body');
  await page.waitForTimeout(400);
  const bodyText = await page.locator('.panel .lex-root').textContent();
  check('editor accepts input', (bodyText || '').includes('Visual body'), bodyText?.slice(0, 30));

  // Theme toggle: switches to dark and updates the root.
  await page.locator('.boards button[aria-label="Toggle light/dark theme"]').click();
  await page.waitForTimeout(400);
  const darkRoot = await page.evaluate(() => document.documentElement.dataset.theme);
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('theme switches to dark', darkRoot === 'dark', darkRoot);
  check('dark background applied', darkBg === 'rgb(22, 24, 29)', darkBg);
  await page.screenshot({ path: path.join(SHOTS, 'u12-dark.png') });
  console.log(`screenshot: ${path.join(SHOTS, 'u12-dark.png')}`);
  await page.locator('.boards button[aria-label="Toggle light/dark theme"]').click();
  await page.waitForTimeout(400);

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
  await page.screenshot({ path: path.join(SHOTS, 'u12-empty.png') });
  console.log(`screenshot: ${path.join(SHOTS, 'u12-empty.png')}`);

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
