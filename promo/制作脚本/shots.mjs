// 宣传片镜头采集。node shots.mjs [--preview] [名字...]
// 预览：dsf 1，每个镜头只截首/中/尾三帧；正式：dsf 2，逐帧
import { launch, newPage, adv, ff, until, Rec, APP, HERE } from './lib.mjs';
import path from 'node:path';
import fs from 'node:fs';

const PREVIEW = process.argv.includes('--preview');
const VERT = process.argv.includes('--v');
const VP = VERT ? { w: 432, h: 768, dsf: PREVIEW ? 1 : 2.5 } : { dsf: PREVIEW ? 1 : 2 };
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const FPS = 30;
const CLEAN = '.autobar,.toasts{display:none!important}';
const CLEAN_ALL = CLEAN + ' .caption,.modal-mask,.vp-tools,.cams{display:none!important} .viewport{position:fixed!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;z-index:40!important;margin:0!important}';

// step：0 起的步骤序号，等它成为当前步骤后再过 delay 毫秒开拍；orbit：拍摄期间相机绕目标转过的角度（度）
const B = 2.6, PAD = 0.6; // 一小节 2.6 s（92.3 BPM），每个镜头多拍 0.6 s 供转场重叠
const SHOTS = [
  { name: 'home', route: '', dur: 2 * B + PAD, home: true },
  { name: 'michelson', exp: 'michelson', step: 6, delay: 1500, dur: 2 * B + PAD, speed: 1, orbit: 6, css: CLEAN },
  { name: 'snake', exp: 'snake', step: 1, delay: 3000, dur: B + PAD, speed: 1, orbit: 5 },
  { name: 'mwhite', exp: 'michelson', step: 8, delay: 3000, dur: B + PAD, orbit: 8 },
  { name: 'zeeman', exp: 'zeeman', step: 2, delay: 1500, dur: B + PAD, orbit: 8, pull: 1.15 },
  { name: 'emratio', exp: 'emratio', step: 3, delay: 3500, dur: B + PAD, orbit: 10 },
  { name: 'chladni', exp: 'chladni', step: 4, delay: 5000, dur: B + PAD, orbit: 6 },
  { name: 'oscilloscope', exp: 'oscilloscope', step: 4, delay: 2500, dur: B + PAD, orbit: 8, pull: 2.6 },
  { name: 'newton', exp: 'newton', step: 6, delay: 1500, dur: B + PAD, orbit: 8 },
  { name: 'stringwave', exp: 'stringwave', step: 1, delay: 3000, dur: B + PAD, orbit: 8 },
  { name: 'spectro', exp: 'spectro', step: 5, delay: 2500, dur: B + PAD, orbit: 8 },
  { name: 'bohr', exp: 'bohr', step: 1, delay: 2500, dur: B + PAD, orbit: 8 },
  { name: 'bench', route: 'bench', dur: B + PAD, bench: '彩虹' },
  { name: 'wave', route: 'wave', dur: 2 * B + PAD, wave: true },
  { name: 'analysis', exp: 'polar', analysis: true, dur: 2 * B + PAD, css: CLEAN + ' .caption{display:none!important}' },
];

const b = await launch();
for (const s of SHOTS) {
  if (only.length && !only.includes(s.name)) continue;
  const t0 = Date.now();
  const page = await newPage(b, VP);
  const dir = path.join(HERE, (PREVIEW ? 'prev' : 'frames') + (VERT ? '_v' : ''), s.name);
  fs.rmSync(dir, { recursive: true, force: true });
  const route = s.exp ? 'exp/' + s.exp : s.route;
  await page.goto(APP + '#/' + route, { waitUntil: 'domcontentloaded' });
  let each = null;
  if (s.exp) {
    await until(page, () => !!(window.__app && window.__app.exp), null, 20000);
    await page.addStyleTag({ content: s.css || CLEAN_ALL });
    await page.evaluate(() => { window.__app.toast = () => {}; window.__app.speed = 8; window.__app.runAll(); });
    if (s.analysis) {
      await until(page, () => !window.__app.running, null, 600000, 200);
      await page.evaluate(() => { document.querySelectorAll('.modal-mask').forEach((m) => m.remove()); window.__app.selfCalc = false; window.__app.showAnalysis(); });
      await ff(page, 1500);
      const H = await page.evaluate(() => { const m = document.querySelector('.modal .modal-body') || document.querySelector('.modal'); window.__sc = m; return m.scrollHeight - m.clientHeight; });
      each = async (i, n) => page.evaluate(([y]) => { window.__sc.scrollTop = y; }, [H * 0.75 * (1 - Math.cos(Math.PI * i / n)) / 2]);
    } else {
      const ok = await until(page, (k) => window.__app.openStep >= k, s.step, 600000, 100);
      if (!ok) console.log('!! step not reached', s.name);
      await page.evaluate((v) => { window.__app.speed = v; }, s.speed || 2);
      await ff(page, s.delay);
      if (VERT && !s.css) {
        // 竖屏：只留主观察窗并居中放在上方；相机拉远，画面整体下移，让器材落在下半屏
        await page.addStyleTag({ content: '.views{left:0!important;right:0!important;top:44px!important;bottom:auto!important;align-items:center!important}.views .vw:nth-child(n+2){display:none!important}' });
        await page.evaluate(([k, sh]) => { const st = window.__app.stage, c = st.camera, tg = st.controls.target; c.position.sub(tg).multiplyScalar(k).add(tg); c.lookAt(tg);
          const W = st.container.clientWidth, H = st.container.clientHeight; c.setViewOffset(W, H, 0, -H * sh, W, H); c.updateProjectionMatrix(); st.invalidate(); }, [s.pull || 1.5, s.shift ?? 0.2]);
      }
      const deg = s.orbit || 0;
      const n = Math.round(s.dur * FPS);
      each = async (i) => page.evaluate(([d]) => {
        const st = window.__app.stage, c = st.camera, tg = st.controls.target;
        const dx = c.position.x - tg.x, dz = c.position.z - tg.z, a = d * Math.PI / 180;
        c.position.x = tg.x + dx * Math.cos(a) - dz * Math.sin(a);
        c.position.z = tg.z + dx * Math.sin(a) + dz * Math.cos(a);
        c.lookAt(tg); st.invalidate();
      }, [deg / n]);
    }
  } else if (s.home) {
    await until(page, () => !!document.querySelector('[data-id]'), null, 20000);
    await ff(page, 500);
    const H = await page.evaluate(() => { const h = document.querySelector('.home'); return h.scrollHeight - h.clientHeight; });
    const top = 520, end = Math.min(H, 520 + 2600);
    each = async (i, n) => page.evaluate(([y]) => { document.querySelector('.home').scrollTop = y; }, [top + (end - top) * (1 - Math.cos(Math.PI * i / n)) / 2]);
  } else if (s.bench) {
    await ff(page, 1500);
    await page.evaluate((n) => { const s = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.text.includes(n))); const o = [...s.options].find((o) => o.text.includes(n)); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); }, s.bench);
    await ff(page, 800);
  } else if (s.wave) {
    await ff(page, 1500);
    // 观察距离 z 从 60 mm 对数扫到 6 m：菲涅耳衍射一路过渡到夫琅禾费衍射
    each = async (i, n) => page.evaluate(([k]) => {
      const inp = [...document.querySelectorAll('input[type=range]')][0];
      const lo = +inp.min, hi = +inp.max, e = (1 - Math.cos(Math.PI * k)) / 2;
      inp.value = lo + (hi - lo) * (0.18 + 0.62 * e);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }, [i / n]);
  }
  const n = Math.round(s.dur * FPS);
  const rec = new Rec(dir, FPS);
  if (PREVIEW) {
    for (let i = 0; i < n; i++) {
      if (each) await each(i, n);
      await adv(page, 1000 / FPS);
      if (i === 0 || i === (n >> 1) || i === n - 1) { await adv(page, 0); fs.mkdirSync(dir, { recursive: true }); await page.screenshot({ path: path.join(dir, `${i}.jpg`), type: 'jpeg', quality: 70 }); }
    }
  } else await rec.shoot(page, n, each);
  console.log(s.name, n, 'frames', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  await page.close();
}
await b.close();
