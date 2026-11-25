// 交流电路仿真桥：把实验桌上的接线转换成 SPICE 网表，交给 spice-ts（MIT 许可，TypeScript 写的 SPICE 引擎，
// 梯形积分 + 自适应步长，结果与 ngspice 对照验证过）计算。本模块不依赖 three.js，可在 node 里直接测试。
//
// 示波器上看到的是电路的“周期稳态”。这里用打靶法（shooting，PSS 分析的标准做法）直接求它：
// 线性电路一个周期的状态映射是仿射的，x(T) = Φ·x(0) + b，x 为各电容电压、电感电流。
// 把同一电路复制 n+1 份放进一张网表（第 0 份初值为零，第 k 份只有第 k 个状态初值为 1 个单位），
// 一次瞬态计算就得到 Φ 和 b；解 (I−Φ)x* = b 得稳态初值，各份波形线性组合即为稳态波形。
// 不必等待暂态衰减，交流耦合（时间常数 0.1 s）对 1 kHz 信号也能一步算准。
// 多个信号源频率不同时按叠加原理分别计算（线性电路成立），直流部分用 .op 求工作点。

let LIB = null;
export const spiceLib = () => (LIB ||= import('@spice-ts/core'));

const num = (v) => (Number.isFinite(v) ? String(+v.toPrecision(12)) : '0');
export const GLEAK = 1e9; // 每个节点经 1 GΩ 接地，保证悬空节点有确定电位

/**
 * 信号源波形。w = { shape:'sine'|'square'|'triangle'|'dc', f (Hz), amp (峰值, V), off (直流偏置, V), duty?, rise? }
 * 返回 SPICE 源描述（只含交变部分 + 偏置）
 */
export function srcSpec(w) {
  if (!w || !(w.f > 0) || w.shape === 'dc') return `DC ${num(w ? w.off || 0 : 0)}`;
  const T = 1 / w.f, A = w.amp, o = w.off || 0;
  if (w.shape === 'sine') return `SIN(${num(o)} ${num(A)} ${num(w.f)})`;
  if (w.shape === 'triangle') return `PULSE(${num(o - A)} ${num(o + A)} 0 ${num(T / 2)} ${num(T / 2)} 0 ${num(T)})`;
  const tr = Math.min(w.rise ?? 20e-9, T / 200), duty = w.duty ?? 0.5;
  return `PULSE(${num(o - A)} ${num(o + A)} 0 ${num(tr)} ${num(tr)} ${num(Math.max(tr, duty * T - tr))} ${num(T)})`;
}
/** 波形的解析值（不经电路，供测试与发生器自身显示） */
export function srcValue(w, t) {
  if (!w || !(w.f > 0) || w.shape === 'dc') return w ? w.off || 0 : 0;
  const ph = ((t * w.f) % 1 + 1) % 1, A = w.amp, o = w.off || 0;
  if (w.shape === 'sine') return o + A * Math.sin(2 * Math.PI * ph);
  if (w.shape === 'triangle') return o + A * (ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph);
  return o + (ph < (w.duty ?? 0.5) ? A : -A);
}

/**
 * 由元件表建立线性电路。
 * elems: [{type:'W'|'R'|'C'|'L'|'V', a, b, R|C|L|w, r?}]，a、b 为节点名（字符串），'0' 为大地。
 *   W：导线（并入同一节点）；V：理想电压源（a 为正极）串联内阻 r，波形 w。
 * earth: 额外直接接大地的节点名列表。
 */
export class LinearNet {
  constructor(elems, earth = []) {
    const parent = new Map();
    const f = (x) => { if (!parent.has(x)) parent.set(x, x); while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const join = (a, b) => { const ra = f(a), rb = f(b); if (ra !== rb) parent.set(ra, rb); };
    for (const e of elems) if (e.type === 'W') join(e.a, e.b);
    for (const n of earth) join(n, '0');
    this.find = f;
    const names = new Map();
    const gnd = f('0');
    this.node = (id) => { const r = f(id); if (r === gnd) return '0'; if (!names.has(r)) names.set(r, 'n' + (names.size + 1)); return names.get(r); };
    // 元件：同一对节点上的电容合并，短接的电感/电容丢弃（零电阻回路的状态无意义）
    const parts = [], caps = new Map();
    for (const e of elems) {
      if (e.type === 'W') continue;
      const a = this.node(e.a), b = this.node(e.b);
      if (e.type === 'C') {
        if (a === b || !(e.C > 0)) continue;
        const k = [a, b].sort().join('|');
        const c = caps.get(k);
        if (c) { c.C += e.C; continue; } // 并联电容合并
        const p = { type: 'C', a, b, C: e.C }; caps.set(k, p); parts.push(p);
      } else if (e.type === 'L') {
        if (a === b || !(e.L > 0)) continue;
        parts.push({ type: 'L', a, b, L: e.L });
      } else if (e.type === 'R') {
        if (a === b) continue;
        parts.push({ type: 'R', a, b, R: Math.max(e.R, 1e-6) });
      } else if (e.type === 'V') {
        parts.push({ type: 'V', a, b, w: e.w, r: e.r || 0, src: e.src ?? e });
      }
    }
    // 只由电容（和无内阻电压源）组成的回路：各电容的 UIC 初值互相矛盾，电路也没有意义上的独立状态。
    // 按容量从大到小加入，闭合回路的那只（最小的）串一个 1 Ω 引线电阻，回路就有了独立状态。
    const extra = [], up = new Map();
    const g = (x) => { if (!up.has(x)) up.set(x, x); while (up.get(x) !== x) x = up.get(x); return x; };
    const loopers = [...parts.filter((p) => p.type === 'V' && !(p.r > 0)), ...parts.filter((p) => p.type === 'C').sort((p, q) => q.C - p.C)];
    for (const p of loopers) {
      const ra = g(p.a), rb = g(p.b);
      if (ra !== rb) { up.set(ra, rb); continue; }
      if (p.type !== 'C') continue;
      const m = `cl${extra.length + 1}`;
      extra.push(m); parts.push({ type: 'R', a: m, b: p.b, R: 1 }); p.b = m;
    }
    this.parts = parts;
    this.nodes = [...names.values(), ...extra];
    this.states = parts.filter((p) => p.type === 'C' || p.type === 'L');
    this.sources = parts.filter((p) => p.type === 'V');
    parts.forEach((p, i) => (p.id = i + 1));
    // 用于判断是否需要重算的指纹
    this.key = parts.map((p) => `${p.type}${p.a},${p.b},${p.R ?? p.C ?? p.L ?? srcSpec(p.w) + ':' + p.r}`).join(';');
  }

  /** 第 k 份电路的元件卡片。active: 参与本次计算的源（其余源置零）；ic: 状态初值 */
  cards(k, active, ic) {
    const N = (n) => (n === '0' ? '0' : `${n}_${k}`), out = [];
    for (const n of this.nodes) out.push(`RG${n}_${k} ${N(n)} 0 ${GLEAK}`);
    for (const p of this.parts) {
      const nm = `${p.id}_${k}`;
      if (p.type === 'R') out.push(`R${nm} ${N(p.a)} ${N(p.b)} ${num(p.R)}`);
      else if (p.type === 'C') out.push(`C${nm} ${N(p.a)} ${N(p.b)} ${num(p.C)}` + (ic ? ` IC=${num(ic.get(p) || 0)}` : ''));
      else if (p.type === 'L') out.push(`L${nm} ${N(p.a)} ${N(p.b)} ${num(p.L)}` + (ic ? ` IC=${num(ic.get(p) || 0)}` : ''));
      else if (p.type === 'V') {
        const spec = active.includes(p) ? srcSpec(p.w) : 'DC 0';
        if (p.r > 0) { out.push(`V${nm} vi${nm} ${N(p.b)} ${spec}`); out.push(`RV${nm} vi${nm} ${N(p.a)} ${num(p.r)}`); }
        else out.push(`V${nm} ${N(p.a)} ${N(p.b)} ${spec}`);
      }
    }
    return out;
  }
}

/** 线性插值重采样到 [0,T) 上的 n 个等距点 */
function resample(t, v, T, n) {
  const out = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const ti = (i / n) * T;
    while (j < t.length - 2 && t[j + 1] < ti) j++;
    if (ti <= t[0]) { out[i] = v[0]; continue; }
    const t0 = t[j], t1 = t[j + 1];
    out[i] = t1 > t0 ? v[j] + ((v[j + 1] - v[j]) * (ti - t0)) / (t1 - t0) : v[j];
  }
  return out;
}

/** 列主元高斯消元，返回 null 表示奇异 */
function solveDense(A, b) {
  const n = b.length;
  A = A.map((r) => r.slice()); b = b.slice();
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(A[i][k]) > Math.abs(A[p][k])) p = i;
    if (Math.abs(A[p][k]) < 1e-13) return null;
    [A[k], A[p]] = [A[p], A[k]]; [b[k], b[p]] = [b[p], b[k]];
    for (let i = k + 1; i < n; i++) { const f = A[i][k] / A[k][k]; if (f) { for (let j = k; j < n; j++) A[i][j] -= f * A[k][j]; b[i] -= f * b[k]; } }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j]; x[i] = s / A[i][i]; }
  return x;
}

const unitOf = (p) => (p.type === 'C' ? 1 : 1e-3); // 打靶的单位初值：电容 1 V，电感 1 mA

/**
 * 求周期稳态。
 * probes: { name: [nodeA, nodeB] }（测 A、B 间电压，节点名为接线前的原始名）
 * 返回 { groups:[{T, data:{name:Float64Array}}], dc:{name:number}, at(name,t), pp(name), ms }
 */
export async function periodicSteady(net, probes, { samples: nS = 8192, reltol = 1e-6 } = {}) {
  const { simulate } = await spiceLib();
  const t0 = performance.now();
  const pk = Object.entries(probes).map(([name, [a, b]]) => [name, net.node(a), net.node(b)]);
  const known = new Set(net.nodes); // 没接进电路的节点电位为 0
  const ac = new Map();
  for (const s of net.sources) if (s.w && s.w.f > 0 && s.w.shape !== 'dc') {
    const key = num(s.w.f);
    (ac.get(key) || ac.set(key, []).get(key)).push(s);
  }
  const groups = [];
  for (const srcs of ac.values()) {
    const T = 1 / srcs[0].w.f;
    // 只让本组源的交变部分参与（偏置并入直流部分）
    const act = srcs.map((s) => ({ ...s, w: { ...s.w, off: 0 } }));
    const view = Object.create(net);
    view.parts = net.parts.map((p) => act.find((q) => q.id === p.id) || p);
    const actP = view.parts.filter((p) => act.some((q) => q.id === p.id));
    const S = net.states, n = S.length;
    const lines = ['* pss'];
    for (let k = 0; k <= n; k++) {
      const ic = new Map(S.map((p, i) => [p, i + 1 === k ? unitOf(p) : 0]));
      lines.push(...LinearNet.prototype.cards.call(view, k, actP, ic));
    }
    // 步长：每周期至少 1000 步；有 LC 振荡时每个固有周期至少 200 步（波形按时间点线性插值，步长决定显示与读数精度）
    let dtMax = T / 1000;
    for (const l of net.parts) if (l.type === 'L') for (const c of net.parts) if (c.type === 'C' && c.C >= 1e-9) dtMax = Math.min(dtMax, (2 * Math.PI * Math.sqrt(l.L * c.C)) / 200);
    dtMax = Math.max(dtMax, T / 40000);
    const samples = Math.min(65536, Math.max(nS, Math.ceil((2 * T) / dtMax))); // 采样点不少于每步 2 个
    lines.push(`.tran ${num(T / samples)} ${num(T)} UIC`, '.end');
    const res = await simulate(lines.join('\n'), { maxTimestep: dtMax, reltol, vntol: 1e-9, abstol: 1e-15 });
    const tr = res.transient, tt = tr.time, last = tt.length - 1;
    const V = (n, k) => (n === '0' || !known.has(n) ? null : tr.voltage(`${n}_${k}`));
    const vAt = (n, k, i) => { const a = V(n, k); return a ? a[i] : 0; };
    const stateEnd = (p, k) => (p.type === 'C' ? vAt(p.a, k, last) - vAt(p.b, k, last) : tr.current(`L${p.id}_${k}`)[last]);
    const wave = (k) => {
      const o = {};
      for (const [name, a, b] of pk) {
        const va = V(a, k), vb = V(b, k), d = new Float64Array(tt.length);
        for (let i = 0; i < tt.length; i++) d[i] = (va ? va[i] : 0) - (vb ? vb[i] : 0);
        o[name] = resample(tt, d, T, samples);
      }
      return o;
    };
    const w0 = wave(0);
    let x = [];
    if (n) {
      const b = S.map((p) => stateEnd(p, 0));
      const A = S.map((_, i) => S.map((q, j) => (i === j ? 1 : 0) - (stateEnd(S[i], j + 1) - b[i]) / unitOf(q)));
      x = solveDense(A, b) || b.map(() => 0);
      const base = {};
      for (const [name] of pk) base[name] = w0[name].slice();
      for (let j = 0; j < n; j++) {
        if (!x[j]) continue;
        const wk = wave(j + 1), c = x[j] / unitOf(S[j]);
        for (const [name] of pk) { const d = w0[name], o = base[name], e = wk[name]; for (let i = 0; i < samples; i++) d[i] += c * (e[i] - o[i]); }
      }
    }
    groups.push({ T, f: 1 / T, data: w0, sources: srcs.map((s) => s.src) });
  }
  // 直流部分：全部源的偏置 + 直流源
  const dc = {};
  const hasDC = net.sources.some((s) => (s.w && s.w.off) || !(s.w && s.w.f > 0));
  for (const [name] of pk) dc[name] = 0;
  if (hasDC) {
    const view = Object.create(net);
    view.parts = net.parts.map((p) => (p.type === 'V' ? { ...p, w: { shape: 'dc', off: p.w && p.w.f > 0 && p.w.shape !== 'dc' ? p.w.off || 0 : p.w ? (p.w.off || 0) : 0 } } : p));
    const lines = ['* op', ...LinearNet.prototype.cards.call(view, 0, view.parts.filter((p) => p.type === 'V'), null), '.op', '.end'];
    const r = await simulate(lines.join('\n'));
    const v = (n) => (n === '0' || !known.has(n) ? 0 : r.dc.voltage(`${n}_0`));
    for (const [name, a, b] of pk) dc[name] = v(a) - v(b);
  }
  return makeResult(groups, dc, performance.now() - t0);
}

function makeResult(groups, dc, ms) {
  const at = (name, t) => {
    let s = dc[name] || 0;
    for (const g of groups) {
      const d = g.data[name], n = d.length;
      const u = (((t / g.T) % 1) + 1) % 1 * n, i = Math.floor(u), fr = u - i;
      s += d[i % n] * (1 - fr) + d[(i + 1) % n] * fr;
    }
    return s;
  };
  return { groups, dc, ms, at };
}
