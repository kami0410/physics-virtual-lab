// 实验进度保存：做到一半刷新、误关页面、退回目录，下次进来接着做。
//
// 存在本机 localStorage（每个实验一条，'progress:v1:<实验 id>'），保存：
//   · 随机种子——实验里随机生成的“未知量”（待测样品、元件误差、隐藏参数）都在构造时生成，
//     用同一个种子重建，仪器还是上次那一台，已记的数据才对得上；
//   · 器材摆放（导轨位置 / 插槽 / 自由摆放的位姿、等高共轴偏差）、导线、各旋钮开关的值；
//   · 数据表（含自己读数的待填单元与核对结果、操作问题标记）与步骤完成情况。
// 随时间演化的过程量（正在加热的温度、计时中的秒表等）不保存，恢复后从当前设置重新开始演化。
// 实验也可以写 saveState() / loadState(s) 保存自己特有的状态。

const PREFIX = 'progress:v1:';
const VALUE_TYPES = new Set(['slider', 'knob', 'toggle', 'select', 'segment']);

/** 32 位种子的小型伪随机数发生器（mulberry32） */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 用 Math.random 取种子：测试脚本给 Math.random 设了种子时，整个实验仍可复现
export function newSeed() { return (Math.random() * 4294967296) >>> 0; }

export function loadProgress(id) {
  try { const s = JSON.parse(localStorage.getItem(PREFIX + id) || 'null'); return s && typeof s === 'object' ? s : null; } catch { return null; }
}
export function clearProgress(id) { try { localStorage.removeItem(PREFIX + id); } catch { /* 无痕模式等 */ } }
function writeProgress(id, s) {
  try { localStorage.setItem(PREFIX + id, JSON.stringify(s)); return true; } catch { return false; }
}

/** 目录页用：{ done, total, rows, t } 或 null */
export function progressSummary(id) {
  const s = loadProgress(id);
  if (!s || !Array.isArray(s.steps)) return null;
  return { done: s.steps.filter(Boolean).length, total: s.steps.length, rows: (s.tables || []).reduce((n, t) => n + (t.rows ? t.rows.length : 0), 0), t: s.t };
}

/** 实验结构的指纹：实验改版（步骤、数据表变了）后旧存档作废，不硬往新结构里套 */
function signature(app) {
  return JSON.stringify([app.steps.map((s) => s.title), app.tables.map((t) => [t.id, t.spec.columns.map((c) => c.key)])]);
}

/** 一组控件描述符 → { 标签: 值 }；同名标签加序号区分 */
function readControls(descs) {
  const out = {}, seen = {};
  for (const d of descs || []) {
    if (!d || !VALUE_TYPES.has(d.type) || !d.label || typeof d.get !== 'function' || typeof d.set !== 'function') continue;
    const n = (seen[d.label] = (seen[d.label] || 0) + 1);
    let v;
    try { v = d.get(); } catch { continue; }
    if (typeof v === 'number' ? isFinite(v) : typeof v === 'boolean' || typeof v === 'string') out[n > 1 ? `${d.label}#${n}` : d.label] = v;
  }
  return out;
}

/**
 * 把保存的值写回控件。开关类最后设：先把限流电阻、量程这些调好再合闸，
 * 免得恢复过程中出现“先通电后调电阻”的瞬间把表打坏。有些控件的取值范围依赖别的控件，所以做两遍。
 */
function writeControls(descs, saved) {
  if (!saved) return;
  const list = [], seen = {};
  for (const d of descs || []) {
    if (!d || !VALUE_TYPES.has(d.type) || !d.label || typeof d.set !== 'function') continue;
    const n = (seen[d.label] = (seen[d.label] || 0) + 1);
    const k = n > 1 ? `${d.label}#${n}` : d.label;
    if (k in saved) list.push([d, saved[k]]);
  }
  const apply = (d, v) => {
    try {
      const cur = d.get();
      if (cur === v || (typeof cur === 'number' && typeof v === 'number' && Math.abs(cur - v) < 1e-12)) return;
      d.set(typeof cur === 'number' && typeof v === 'string' && v !== '' && isFinite(+v) ? +v : v);
    } catch (err) { console.warn('恢复控件失败', d.label, err); }
  };
  for (let pass = 0; pass < 2; pass++) for (const [d, v] of list) if (d.type !== 'toggle') apply(d, v);
  for (const [d, v] of list) if (d.type === 'toggle') apply(d, v);
}

/** 实验对象上的接线（电路 Circuit 等：有 wires 数组和 connect 方法的对象） */
function wiringOf(exp) {
  const out = [];
  for (const [k, v] of Object.entries(exp)) if (v && Array.isArray(v.wires) && typeof v.connect === 'function' && typeof v.clear === 'function') out.push([k, v]);
  return out;
}

export function snapshot(app) {
  const exp = app.exp, comps = {}, placed = [];
  for (const c of app.comps.values()) {
    let ctl = {};
    try { ctl = readControls(c.controls ? c.controls() : []); } catch { /* 没放上台时某些控件读不出来 */ }
    if (Object.keys(ctl).length) comps[c.key] = ctl;
    if (!c.placed || c.fixed) continue;
    const p = { key: c.key, seq: c._seq || 0 };
    if (c.zone === 'rail') p.pos = c.pos;
    else if (c.slot) p.slot = c.slot;
    else if (c.zone === 'slot' && c.tx != null) p.free = { x: c.tx, z: c.tz, rot: c.rot ?? 0 };
    if (c.mis) p.mis = { ...c.mis };
    placed.push(p);
  }
  placed.sort((a, b) => a.seq - b.seq);
  // 固定仪器不用摆放，但等高共轴偏差要记
  const mis = {};
  for (const c of app.comps.values()) if (c.fixed && c.mis) mis[c.key] = { ...c.mis };
  let global = {};
  try { global = readControls(exp.globalControls ? exp.globalControls() : []); } catch { /* 忽略 */ }
  const wires = {};
  for (const [k, cir] of wiringOf(exp)) wires[k] = cir.wires.map((w) => [w.a, w.b]);
  let custom;
  if (exp.saveState) { try { custom = exp.saveState(); } catch (err) { console.warn(err); } }
  return {
    sig: signature(app), seed: app.seed, free: app.placeFree,
    placed, mis, comps, global, wires, custom,
    tables: app.tables.map((t) => ({ id: t.id, rows: t.rows })),
    steps: app.stepDone.slice(),
  };
}

/** 存档是否值得保留：和刚打开时一样（什么都没动）就不存 */
export function saveProgress(app, snap) {
  const body = JSON.stringify(snap);
  if (body === app._snap0) { if (app._snapLast !== body) { clearProgress(app.meta.id); app._snapLast = body; } return; }
  if (body === app._snapLast) return;
  if (writeProgress(app.meta.id, { ...snap, t: Date.now() })) app._snapLast = body;
}

/** 按存档恢复。返回 true 表示恢复了 */
export function restore(app, s) {
  if (!s || s.sig !== signature(app)) return false;
  const exp = app.exp;
  if (s.free != null && s.free !== app.placeFree && (app.hasTable || app.coax)) app.placeFree = s.free;
  // 1. 摆放器材（按当初放上去的顺序，叠放的插槽才能还原到原来的层）
  for (const p of s.placed || []) {
    const c = app.comps.get(p.key);
    if (!c || c.placed) continue;
    try {
      if (p.pos != null) app.place(c, { pos: p.pos, exact: true, silent: true });
      else if (p.free) app.place(c, { table: { x: p.free.x, z: p.free.z, rot: p.free.rot }, silent: true });
      else app.place(c, { slot: p.slot, exact: true, silent: true });
      if (p.mis && app.coax && app.coax.has(c)) { Object.assign(app.coax.mis(c), p.mis); app.coax.pose(c); }
    } catch (err) { console.warn('恢复摆放失败', p.key, err); }
  }
  for (const [k, m] of Object.entries(s.mis || {})) {
    const c = app.comps.get(k);
    if (c && app.coax && app.coax.has(c)) { Object.assign(app.coax.mis(c), m); app.coax.pose(c); }
  }
  // 2. 接线
  for (const [k, cir] of wiringOf(exp)) {
    const ws = s.wires && s.wires[k]; if (!ws) continue;
    try { cir.clear(); for (const [a, b] of ws) cir.connect(a, b); } catch (err) { console.warn('恢复接线失败', err); }
  }
  // 3. 旋钮开关
  for (const c of app.comps.values()) { try { writeControls(c.controls ? c.controls() : [], s.comps && s.comps[c.key]); } catch { /* 忽略 */ } }
  try { writeControls(exp.globalControls ? exp.globalControls() : [], s.global); } catch { /* 忽略 */ }
  if (s.custom != null && exp.loadState) { try { exp.loadState(s.custom); } catch (err) { console.warn(err); } }
  // 4. 数据表
  for (const ts of s.tables || []) {
    const t = app.tables.find((x) => x.id === ts.id);
    if (t && Array.isArray(ts.rows)) { t.rows = ts.rows; t.changed(); }
  }
  // 5. 步骤
  if (Array.isArray(s.steps) && s.steps.length === app.stepDone.length) {
    app.stepDone = s.steps.map(Boolean);
    app.stepIdx = 0;
    while (app.stepIdx < app.steps.length && app.stepDone[app.stepIdx]) app.stepIdx++;
    app.openStep = app.stepIdx;
  }
  return true;
}
