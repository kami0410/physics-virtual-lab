import { chromium } from 'file:///D:/D物理实验竞赛自选2/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const APP = pathToFileURL('D:/D物理实验竞赛自选2/dist-single/index.html').href;
const VT = fs.readFileSync(path.join(HERE, 'vt.js'), 'utf8');

export async function launch(headed = false) {
  const opts = { headless: !headed, args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11', '--hide-scrollbars', '--font-render-hinting=none'] };
  for (const channel of ['chrome', 'msedge']) { try { return await chromium.launch({ ...opts, channel }); } catch {} }
  throw new Error('no chrome');
}

export async function newPage(browser, { w = 1600, h = 900, dsf = 2, seed = 7 } = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dsf });
  await page.addInitScript((seed) => {
    let s = seed >>> 0 || 1;
    Math.random = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    window.confirm = () => true;
    try { localStorage.setItem('quality', 'high'); } catch {}
  }, seed);
  await page.addInitScript(VT);
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return page;
}

export const adv = (page, ms, frames = true) => page.evaluate(([ms, f]) => window.__vt.advance(ms, f), [ms, frames]);

/** 在不截图的情况下快进（每步 dt 毫秒） */
export async function ff(page, ms, dt = 50) { for (let t = 0; t < ms; t += dt) await adv(page, dt); }

export async function until(page, fn, arg, maxMs = 60000, dt = 50) {
  for (let t = 0; t < maxMs; t += dt) {
    if (await page.evaluate(fn, arg)) return true;
    await adv(page, dt);
  }
  return false;
}

/** 录制：每帧推进 1000/fps ms 再截图，帧图写到 dir */
export class Rec {
  constructor(dir, fps = 30) { this.dir = dir; this.fps = fps; this.n = 0; fs.mkdirSync(dir, { recursive: true }); }
  async shoot(page, frames, each) {
    for (let i = 0; i < frames; i++) {
      if (each) await each(i, frames);
      await adv(page, 1000 / this.fps);
      await adv(page, 0); // 让 rAF 里的渲染落到画面上
      const f = path.join(this.dir, String(this.n++).padStart(5, '0') + '.jpg');
      await page.screenshot({ path: f, type: 'jpeg', quality: 93, animations: 'allow', caret: 'hide' });
    }
  }
}
