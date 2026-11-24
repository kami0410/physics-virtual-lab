// 全部实验的自动化回归测试（用本机 Chrome / Edge 无头运行离线单文件版 dist-single/index.html）
//   node tests/e2e.mjs [--only id1,id2] [--seed 7] [--monkey 400] [--no-auto] [--no-monkey] [--headed]
// 1. 一键运行：所有步骤完成、数据处理无 NaN/报错、结果中的“相对误差/相对偏差”不超过阈值；统计 update() 耗时
// 2. 随机操作（monkey）：随机放置/取下器材、拖导轨、拧旋钮、切换开关、点记录按钮、做数据处理，检查是否抛异常
import { chromium } from 'playwright-core';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'dist-single', 'index.html');
if (!fs.existsSync(file)) { console.error('找不到 dist-single/index.html，请先运行 npm run build:single'); process.exit(2); }
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const SEED = +arg('--seed', 1), MONKEY = +arg('--monkey', 400), ONLY = arg('--only', '');
const MAX_ERR = 5; // %：一键运行结果允许的最大相对误差
const URL0 = pathToFileURL(file).href;

async function launch() {
  const opts = { headless: !has('--headed'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
  for (const channel of ['chrome', 'msedge']) {
    try { return await chromium.launch({ ...opts, channel }); } catch { /* 尝试下一个 */ }
  }
  throw new Error('没有找到可用的 Chrome 或 Edge');
}

/** 页面初始化：可复现的随机数，并收集错误 */
const INIT = (seed) => {
  let s = seed >>> 0 || 1;
  Math.random = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  window.__errors = [];
  window.addEventListener('error', (e) => window.__errors.push('error: ' + e.message));
  window.addEventListener('unhandledrejection', (e) => window.__errors.push('rejection: ' + (e.reason && e.reason.message || e.reason)));
  const ce = console.error; console.error = (...a) => { window.__errors.push('console: ' + a.map(String).join(' ').slice(0, 300)); ce.apply(console, a); };
  window.confirm = () => true;
  window.open = () => ({ document: { open() {}, write() {}, close() {} } });
};

async function openExp(browser, id, seed) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.addInitScript(INIT, seed);
  // --gpu：在软件渲染器上也强制走 GPU 着色器路径（检验着色器）；默认自动（无硬件 GPU 时用 CPU）
  if (has('--gpu')) await page.addInitScript(() => localStorage.setItem('compute', 'gpu'));
  for (let k = 0; ; k++) { try { await page.goto(`${URL0}#/exp/${id}`, { waitUntil: "domcontentloaded", timeout: 60000 }); break; } catch (e) { if (k >= 1) throw e; } }
  await page.waitForFunction(() => window.__app && window.__app.exp, null, { timeout: 30000 });
  await page.evaluate(() => {
    const a = window.__app;
    const ot = a.toast.bind(a);
    window.__bad = []; window.__warn = [];
    a.toast = (m, k) => { if (k === 'bad') window.__bad.push(m); if (k === 'warn') window.__warn.push(m); return ot(m, k); };
    const e = a.exp, up = e.update.bind(e);
    window.__perf = { n: 0, sum: 0, max: 0 };
    e.update = () => { const t = performance.now(); up(); const d = performance.now() - t; const p = window.__perf; p.n++; p.sum += d; if (d > p.max) p.max = d; };
  });
  return page;
}

async function autoRun(browser, id) {
  const page = await openExp(browser, id, SEED);
  const t0 = Date.now();
  await page.evaluate(() => { window.__app.speed = 8; window.__app.runAll(); });
  await page.waitForFunction(() => !window.__app.running, null, { timeout: 240000, polling: 500 });
  const r = await page.evaluate(() => {
    const a = window.__app, res = a.computeAnalysis();
    const text = (res.html || '').replace(/<[^>]+>/g, ' ');
    const errs = [...text.matchAll(/相对(?:误差|偏差)[^0-9−-]{0,12}([−-]?\d+(?:\.\d+)?)\s*%/g)].map((m) => +m[1].replace('−', '-'));
    // 自算模式：每个实验都要给出可核对的结果；把参考值按显示格式填回去必须判为正确
    const ans = res.answers || [];
    const selfBad = ans.length ? a.judgeAnswers(ans, ans.map((x) => a.fmtAns(x, x.value))).filter((x) => !x.ok).map((x) => x.label) : ['没有 answers'];
    return {
      selfBad,
      done: a.stepDone.map((x) => (x ? 1 : 0)).join(''), all: a.stepDone.every(Boolean), ok: !!res.ok,
      nan: /NaN|undefined|Infinity|出错/.test(text), errs, errors: window.__errors, bad: window.__bad, warn: [...new Set(window.__warn)],
      perf: { avg: window.__perf.sum / Math.max(1, window.__perf.n), max: window.__perf.max, n: window.__perf.n },
      // 有“光路台”按钮的实验：做完后导出的光路至少含光源和一个光学元件，且没有隐藏参数
      bench: a.exp.toBench ? (() => { try { const sc = a.exp.toBench({ done: true }); return sc ? `${sc.els.length}:${sc.els.some((e) => e.secret) ? 'secret' : 'open'}` : 'null'; } catch (err) { return 'error ' + err.message; } })() : null,
      // 有“衍射台”按钮的实验：做完后导出的衍射参数有效（孔径、波长、距离都是正数）
      wave: a.exp.toWave ? (() => { try { const sc = a.exp.toWave({ done: true }); if (!sc) return 'null'; const s = sc.s; return s && s.ap && s.lam > 0 && s.z > 0 && Object.values(s.p || {}).every((v) => v > 0) ? 'ok' : 'bad ' + JSON.stringify(s); } catch (err) { return 'error ' + err.message; } })() : null,
    };
  });
  await page.close();
  const problems = [];
  if (!r.all) problems.push(`步骤未全部完成 ${r.done}；提示：${r.warn.join(' / ')}`);
  if (!r.ok) problems.push('数据处理未给出结果');
  if (r.selfBad.length) problems.push('自算核对：' + r.selfBad.join('、'));
  if (r.nan) problems.push('数据处理结果中有 NaN/undefined/出错');
  if (r.bench != null && !/^([2-9]|\d\d+):open$/.test(r.bench)) problems.push(`导出到光路台异常：${r.bench}`);
  if (r.wave != null && r.wave !== 'ok') problems.push(`导出到衍射台异常：${r.wave}`);
  for (const e of r.errs) if (Math.abs(e) > MAX_ERR) problems.push(`相对误差 ${e}% 超过 ${MAX_ERR}%`);
  problems.push(...r.errors, ...r.bad.map((b) => 'toast: ' + b));
  return { id, kind: 'auto', s: Math.round((Date.now() - t0) / 1000), problems, info: `误差 ${r.errs.map((e) => e + '%').join(' ') || '—'} · update 平均 ${r.perf.avg.toFixed(1)} ms / 最大 ${r.perf.max.toFixed(1)} ms` };
}

async function monkey(browser, id, n) {
  const page = await openExp(browser, id, SEED * 7919 + 13);
  const t0 = Date.now();
  const r = await page.evaluate(async (n) => {
    const a = window.__app, log = [], thrown = [];
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const rail = a.zones.find((z) => z.type === 'rail');
    const tick = () => { a.dirty = true; a.frame(1 / 60); };
    const twist = (d) => {
      if (d.type === 'knob') {
        if (d.wrap || d.min == null || Math.random() < 0.7) { const st = Math.random() < 0.5 ? (d.step ?? 0.01) : (d.bigStep ?? 0.1); d.set(d.get() + st * Math.round((Math.random() - 0.5) * 40)); }
        else d.set(d.min + Math.random() * (d.max - d.min));
      } else if (d.type === 'slider') d.set(d.min + Math.random() * (d.max - d.min));
      else if (d.type === 'toggle') d.set(!d.get());
      else if (d.type === 'segment' || d.type === 'select') d.set(pick(d.options).value);
      else if (d.type === 'button') d.onClick();
      else if (d.type === 'readout') d.get();
    };
    for (let i = 0; i < n; i++) {
      const comps = [...a.comps.values()];
      const r = Math.random();
      let what = '';
      try {
        if (r < 0.12) { const c = pick(comps.filter((c) => !c.placed)); if (c) { what = `放置 ${c.key}`; a.place(c, rail && c.zone === 'rail' ? { pos: rail.min + Math.random() * (rail.max - rail.min) } : {}); } }
        else if (r < 0.18) { const c = pick(comps.filter((c) => c.placed && !c.fixed)); if (c) { what = `取下 ${c.key}`; a.remove(c); } }
        else if (r < 0.28) { const c = pick(comps.filter((c) => c.placed && c.zone === 'rail')); if (c) { what = `移动 ${c.key}`; a.setRailPos(c, rail.min + Math.random() * (rail.max - rail.min)); } }
        else if (r < 0.75) {
          const c = pick(comps.filter((c) => c.placed));
          if (c) { a.select(c); const ds = c.controls ? c.controls() : []; const d = pick(ds); if (d) { what = `${c.key}.${d.label}`; twist(d); } }
        } else if (r < 0.82) { const ds = a.exp.globalControls ? a.exp.globalControls() : []; const d = pick(ds); if (d) { what = `全局.${d.label}`; twist(d); } }
        else if (r < 0.96) { const t = pick(a.tables); const b = t && pick(t.spec.buttons || []); if (b) { what = `记录 ${t.id}.${b.label}`; b.onClick(t); } }
        else if (r < 0.98) { what = '数据处理'; a.computeAnalysis(); }
        else { what = '检查步骤'; const s = a.steps[a.stepIdx]; if (s) { s.check && s.check(); s.status && s.status(); } }
        a.changed(); tick();
        if (a.exp.tick) a.exp.tick(0.5);
      } catch (err) { thrown.push(`${what}: ${err && err.message}\n${(err && err.stack || '').split('\n').slice(1, 3).join('\n')}`); }
      if (what) log.push(what);
      if (i % 25 === 0) await new Promise((res) => setTimeout(res, 0));
    }
    for (const t of a.tables) for (const row of t.rows) for (const c of t.spec.columns) if (c.calc) { try { t.value(row, c.key, t.rows.indexOf(row)); } catch (err) { thrown.push(`calc ${t.id}.${c.key}: ${err.message}`); } }
    let ana = ''; try { ana = (a.computeAnalysis().html || '').replace(/<[^>]+>/g, ' '); } catch (err) { thrown.push('analyze: ' + err.message); }
    return { thrown: [...new Set(thrown)], errors: [...new Set(window.__errors)], bad: window.__bad, steps: log.length, anaErr: /出错/.test(ana) ? ana.slice(0, 200) : '' };
  }, n);
  await page.close();
  const problems = [...r.thrown, ...r.errors, ...r.bad.map((b) => 'toast: ' + b)];
  if (r.anaErr) problems.push('数据处理出错：' + r.anaErr);
  return { id, kind: 'monkey', s: Math.round((Date.now() - t0) / 1000), problems, info: `${r.steps} 次随机操作` };
}

async function pool(tasks, k) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: k }, async () => { while (i < tasks.length) { const t = tasks[i++]; try { out.push(await t()); } catch (err) { out.push({ id: t.id, kind: t.kind, problems: ['测试本身出错：' + err.message], info: '' }); } } }));
  return out;
}

const browser = await launch();
const home = await browser.newPage();
await home.goto(URL0);
let ids = await home.$$eval('[data-id]', (els) => els.map((e) => e.dataset.id));
await home.close();
if (ONLY) ids = ids.filter((i) => ONLY.split(',').includes(i));
const tasks = [];
for (const id of ids) {
  if (!has('--no-auto')) { const t = () => autoRun(browser, id); t.id = id; t.kind = 'auto'; tasks.push(t); }
  if (!has('--no-monkey')) { const t = () => monkey(browser, id, MONKEY); t.id = id; t.kind = 'monkey'; tasks.push(t); }
}
// 光路设计台、衍射工作台：逐个载入预设，检查无报错、有光线 / 有图样
async function toolSmoke(browser, route) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.addInitScript(INIT, SEED);
  const t0 = Date.now();
  await page.goto(`${URL0}#/${route}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction((r) => window[r === 'bench' ? '__bench' : '__wave'], route, { timeout: 30000 });
  const r = await page.evaluate(async (route) => {
    const bad = [];
    if (route === 'bench') {
      const b = window.__bench, sel = document.querySelector('[data-a=preset]');
      for (const o of [...sel.options].slice(1)) { b.loadPreset(o.value); if (!b.res.segs.length) bad.push(`${o.value}: 没有光线`); if (b.traceMs > 400) bad.push(`${o.value}: 追迹 ${b.traceMs.toFixed(0)} ms`); }
      // 每种元件都能添加并参与追迹
      for (const btn of document.querySelectorAll('.bp-item')) btn.click();
      b.trace();
      // 分享链接往返：编码 → 用 #/bench?s= 重新打开 → 元件数与类型一致
      const before = b.els.map((e) => e.type).join(','), code = await b.shareCode();
      location.hash = '#/bench?s=' + code;
      for (let i = 0; i < 100 && (window.__bench === b || !window.__bench || window.__bench.els.length === 0); i++) await new Promise((res) => setTimeout(res, 50));
      const after = window.__bench.els.map((e) => e.type).join(',');
      if (after !== before) bad.push(`分享链接往返后元件不一致（${code.length} 字符）`);
      return { bad, info: `${sel.options.length - 1} 个预设、${document.querySelectorAll('.bp-item').length} 种元件、分享链接 ${code.length} 字符` };
    }
    const w = window.__wave, sel = document.querySelector('[data-a=preset]');
    for (const o of [...sel.options].slice(1)) { w.load(+o.value); await new Promise((res) => setTimeout(res, 40)); const I = w.out.res[0].I; let s = 0; for (const v of I) s += v; if (!(s > 0) || !isFinite(s)) bad.push(`${o.textContent}: 图样无效`); }
    // 分享链接往返：载入“光源宽度”预设 → 编码 → #/wave?s= 重新打开 → 参数一致
    w.load(8); await new Promise((res) => setTimeout(res, 60));
    const before = JSON.stringify(w.shareState().s), code = await w.shareCode();
    location.hash = '#/wave?s=' + code;
    for (let i = 0; i < 100 && (window.__wave === w || !window.__wave || !window.__wave.out); i++) await new Promise((res) => setTimeout(res, 50));
    if (JSON.stringify(window.__wave.shareState().s) !== before) bad.push(`衍射台分享链接往返后参数不一致（${code.length} 字符）`);
    return { bad, info: `${sel.options.length - 1} 个典型现象、分享链接 ${code.length} 字符` };
  }, route);
  const errs = await page.evaluate(() => window.__errors);
  await page.close();
  return { id: route, kind: 'tool', s: Math.round((Date.now() - t0) / 1000), problems: [...r.bad, ...errs], info: r.info };
}
if (!ONLY) for (const route of ['bench', 'wave']) { const t = () => toolSmoke(browser, route); t.id = route; t.kind = 'tool'; tasks.push(t); ids.push(route); }
console.log(`测试 ${ids.length} 个实验，种子 ${SEED}…`);
const results = await pool(tasks, 4);
await browser.close();
results.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id) || a.kind.localeCompare(b.kind));
let fail = 0;
for (const r of results) {
  const ok = !r.problems.length; if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${r.id.padEnd(12)} ${r.kind.padEnd(7)} ${String(r.s ?? '').padStart(3)}s  ${r.info}`);
  for (const p of r.problems.slice(0, 8)) console.log('     · ' + p.replace(/\n/g, '\n       '));
}
console.log(fail ? `\n${fail} 项未通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
