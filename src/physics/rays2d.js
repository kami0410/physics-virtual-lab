// 二维非顺序光线追迹引擎（几何光学，单位 mm，y 轴向上）
//
// 每条光线带波长、s/p 两个偏振分量的功率和“来自哪条光源光线（fan）”的编号，与场景中的面逐次求交：
//   玻璃界面：矢量斯涅耳定律 + 菲涅耳公式（s、p 分别计算部分反射），全反射；折射率按材料的 Sellmeier 色散随波长变化。
//            界面两侧的折射率不靠“进/出”标记，而是在交点前后各取一点，判断它落在哪块玻璃里（最上层的那块），
//            因此胶合透镜、玻璃泡在水里、玻璃互相重叠都不需要特殊处理。
//   反射镜（平面、球面、抛物面）、分束镜、透射光栅（各级次方向按光栅方程，强度按缝宽包络）、理想透镜/理想球面镜、
//   挡板与光阑、探测器（记录落点、功率与波长，可设为透明的“测量线”）。
// 追迹完成后用相邻光线（同一光源、同一路径、同一波长）的交点找像：交点落在光线前方为实像，落在后方为虚像。
//
// 算法思路参考 Ray Optics Simulation（https://github.com/ricktu288/ray-optics，Apache-2.0，Yi-Ting Tu 等）：
// 菲涅耳部分反射按 s/p 分别计算、用相邻光线交点检测像点及“实像/虚像/虚物”的判别、理想透镜的出射方向构造。
// 本文件为重新编写的实现（数据结构、界面两侧介质判定、光栅级次强度、像点聚类等均不同），未直接复制其代码。

import { index as glassIndex } from './glassdb.js';

const T_MIN = 2e-5; // 求交的最小步长 (mm)，避免与刚离开的面重复相交
const PROBE = 1e-5; // 判断交点两侧介质时的偏移 (mm)

// ---------------------------------------------------------------- 基本几何
export const v2 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  mul: (a, k) => [a[0] * k, a[1] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1],
  cross: (a, b) => a[0] * b[1] - a[1] * b[0],
  len: (a) => Math.hypot(a[0], a[1]),
  norm: (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; },
  rot: (a, th) => { const c = Math.cos(th), s = Math.sin(th); return [a[0] * c - a[1] * s, a[0] * s + a[1] * c]; },
};
const TAU = Math.PI * 2;
const wrap2pi = (a) => ((a % TAU) + TAU) % TAU;

/**
 * 射线 p + t·d 与一段几何的所有交点（t > tMin），返回 [{t, q, nrm}]，nrm 为单位法线（方向未定）。
 * geom: { type:'line', a, b } 或 { type:'arc', c, r, a0, span }（圆弧从角 a0 逆时针转过 span ≤ 2π）
 */
export function hitGeom(g, p, d, tMin = T_MIN) {
  if (g.type === 'line') {
    const e = [g.b[0] - g.a[0], g.b[1] - g.a[1]];
    const den = d[0] * e[1] - d[1] * e[0];
    if (Math.abs(den) < 1e-14) return [];
    const w = [g.a[0] - p[0], g.a[1] - p[1]];
    const t = (w[0] * e[1] - w[1] * e[0]) / den;
    const s = (w[0] * d[1] - w[1] * d[0]) / den;
    if (t <= tMin || s < 0 || s > 1) return [];
    const L = Math.hypot(e[0], e[1]);
    return [{ t, q: [p[0] + t * d[0], p[1] + t * d[1]], nrm: [-e[1] / L, e[0] / L], s }];
  }
  // 圆弧
  const oc = [p[0] - g.c[0], p[1] - g.c[1]];
  const b = oc[0] * d[0] + oc[1] * d[1];
  const cc = oc[0] * oc[0] + oc[1] * oc[1] - g.r * g.r;
  const disc = b * b - cc;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc), out = [];
  for (const t of [-b - sq, -b + sq]) {
    if (t <= tMin) continue;
    const q = [p[0] + t * d[0], p[1] + t * d[1]];
    const ang = Math.atan2(q[1] - g.c[1], q[0] - g.c[0]);
    if (g.span < TAU - 1e-9 && wrap2pi(ang - g.a0) > g.span + 1e-12) continue;
    out.push({ t, q, nrm: [(q[0] - g.c[0]) / g.r, (q[1] - g.c[1]) / g.r] });
  }
  return out;
}

/** 由“沿边界依次排列”的边构造玻璃体。边：{type:'line', a, b, rim（透镜涂黑的侧边）} 或 {type:'arc', c, r, from, to}（角度，沿边界方向） */
export function makeBody(edges) {
  const geoms = edges.map((e) => {
    if (e.type === 'line') return { type: 'line', a: e.a, b: e.b, absorb: !!e.rim };
    const lo = Math.min(e.from, e.to), span = Math.abs(e.to - e.from);
    return { type: 'arc', c: e.c, r: e.r, a0: wrap2pi(lo), span: Math.min(span, TAU) };
  });
  return { geoms };
}

// 用一条“无理方向”的射线数交点个数判断点是否在闭合边界内（精确几何，不做多边形近似）
const PROBE_DIR = v2.norm([1, 0.3713906763541037]);
export function inside(body, pt) {
  let n = 0;
  for (const g of body.geoms) n += hitGeom(g, pt, PROBE_DIR, 0).length;
  return (n & 1) === 1;
}

// ---------------------------------------------------------------- 物理
/** 菲涅耳反射率（功率）：n1→n2，入射角余弦 c1，折射角余弦 c2 */
export function fresnel(n1, n2, c1, c2) {
  const rs = (n1 * c1 - n2 * c2) / (n1 * c1 + n2 * c2);
  const rp = (n2 * c1 - n1 * c2) / (n2 * c1 + n1 * c2);
  return { Rs: rs * rs, Rp: rp * rp };
}

/** 光栅各级次的相对功率：缝宽占空比 duty 的矩形光栅，m 级 ∝ sinc²(π m·duty)，并对传播级次归一化 */
export function gratingOrders(sinIn, lamNm, lpm, duty = 0.5, maxOrder = 6) {
  const dmm = 1 / lpm, lam = lamNm * 1e-6;
  const out = [];
  let sum = 0;
  for (let m = -maxOrder; m <= maxOrder; m++) {
    const s = sinIn + (m * lam) / dmm;
    if (Math.abs(s) >= 1) continue;
    const x = Math.PI * m * duty;
    const w = m === 0 ? 1 : (Math.sin(x) / x) ** 2;
    if (w < 1e-6) continue;
    out.push({ m, s, w }); sum += w;
  }
  for (const o of out) o.w /= sum || 1;
  return out;
}

// ---------------------------------------------------------------- 引擎
/**
 * 场景（引擎层，与界面无关）：
 *  surfaces: [{ id, obj, kind, geom, ...参数 }]
 *    kind: 'glass'（玻璃体的边，须带 body）| 'mirror'(refl) | 'splitter'(R) | 'blocker' | 'detector'(pass)
 *        | 'grating'(lpm, duty, eff) | 'ideal'(f, c, axis) | 'idealMirror'(f, c, axis)
 *    可选 nrmFn(q) 给出解析法线（抛物面镜用）；gid：同一个物理面拆成多段时共用的编号（找像时视为同一面）
 *  bodies:   [{ id, obj, material, geoms }]，后加入的在上层
 *  rays:     [{ p, d, lam, P, src, fan }]，同一光源的光线按 fan 依次排列（相邻 fan 的光线在空间上相邻）
 *  opts:     { partial: 是否计算部分反射, minP（相对每条光线初始功率的截断阈值）, maxDepth, maxSegs, ambient: 环境折射率材料名 }
 */
export function traceScene({ surfaces, bodies = [], rays, opts = {} }) {
  const minP = opts.minP ?? 2e-3, maxDepth = opts.maxDepth ?? 60, maxSegs = opts.maxSegs ?? 60000, maxLen = opts.maxLen ?? 5000;
  const partial = opts.partial ?? true;
  const nCache = new Map();
  const nOf = (mat, lam) => {
    if (!mat || mat === 'air') return 1;
    const k = mat + '|' + lam;
    let n = nCache.get(k);
    if (n === undefined) { n = glassIndex(mat, lam); nCache.set(k, n); }
    return n;
  };
  const medium = (pt, lam) => {
    for (let i = bodies.length - 1; i >= 0; i--) if (inside(bodies[i], pt)) return nOf(bodies[i].material, lam);
    return nOf(opts.ambient, lam);
  };

  const segs = [], hits = new Map(), stats = { segs: 0, lost: 0, tir: 0, cut: false, absorbed: 0, escaped: 0 };
  const rec = (id, h) => { let a = hits.get(id); if (!a) hits.set(id, (a = [])); a.push(h); };
  // 透明探测器（测量线）不打断光线：单独作为“探针”，在每段光线上检查是否穿过
  const solid = surfaces.filter((s) => !(s.kind === 'detector' && s.pass));
  const probes = surfaces.filter((s) => s.kind === 'detector' && s.pass);
  const stack = [];
  for (let i = rays.length - 1; i >= 0; i--) {
    const r = rays[i];
    const P = r.P ?? 1;
    stack.push({ p: r.p, d: v2.norm(r.d), lam: r.lam ?? 589.3, Ps: r.Ps ?? P / 2, Pp: r.Pp ?? P / 2, P0: P, src: r.src ?? 0, fan: r.fan ?? i, sig: '', depth: 0, opl: 0, n: null });
  }
  while (stack.length) {
    const ray = stack.pop();
    const P = ray.Ps + ray.Pp;
    if (P < minP * ray.P0) { stats.lost += P; continue; } // minP 相对于这条光线出射时的功率
    if (ray.depth > maxDepth || segs.length >= maxSegs) { stats.lost += P; stats.cut = segs.length >= maxSegs; continue; }
    // 最近交点
    let best = null, bs = null;
    for (const s of solid) {
      const hs = hitGeom(s.geom, ray.p, ray.d);
      for (const h of hs) if (!best || h.t < best.t) { best = h; bs = s; }
    }
    const L = best ? best.t : maxLen;
    const end = [ray.p[0] + L * ray.d[0], ray.p[1] + L * ray.d[1]];
    const nHere = ray.n ?? medium([ray.p[0] + PROBE * ray.d[0], ray.p[1] + PROBE * ray.d[1]], ray.lam);
    // final：这段之后光线不再被改变方向（射出场景，或落在光屏、挡板上）——观察者看到的就是这一段
    const final = !best || (best && (bs.kind === 'blocker' || (bs.kind === 'detector' && !bs.pass)));
    segs.push({ a: ray.p, b: end, P, rel: P / ray.P0, lam: ray.lam, src: ray.src, fan: ray.fan, sig: ray.sig, depth: ray.depth, n: nHere, end: !best, final });
    for (const pr of probes) for (const ph of hitGeom(pr.geom, ray.p, ray.d)) if (ph.t < L) rec(pr.id, { q: ph.q, s: ph.s, P, lam: ray.lam, cos: Math.abs(v2.dot(ph.nrm, ray.d)), d: ray.d, src: ray.src, fan: ray.fan, opl: ray.opl + nHere * ph.t, surf: pr });
    if (!best) { stats.escaped += P; continue; }
    const q = best.q, d = ray.d;
    let nrm = bs.nrmFn ? bs.nrmFn(q) : best.nrm;
    let cos1 = -(nrm[0] * d[0] + nrm[1] * d[1]);
    if (cos1 < 0) { nrm = [-nrm[0], -nrm[1]]; cos1 = -cos1; } // 法线朝向入射一侧
    const opl = ray.opl + nHere * L;
    const child = (dir, Ps, Pp, tag, extra) => stack.push({ p: q, d: v2.norm(dir), lam: ray.lam, Ps, Pp, P0: ray.P0, src: ray.src, fan: ray.fan, sig: ray.sig + (bs.gid || bs.id) + tag + ';', depth: ray.depth + 1, opl, n: null, ...extra });
    const reflDir = [d[0] + 2 * cos1 * nrm[0], d[1] + 2 * cos1 * nrm[1]];
    const hit = { q, s: best.s, P, lam: ray.lam, cos: cos1, d, src: ray.src, fan: ray.fan, opl, surf: bs };

    switch (bs.kind) {
      case 'glass': {
        if (bs.geom.absorb) { stats.absorbed += P; break; } // 透镜侧边：磨砂涂黑，吸收
        const n1 = nHere;
        const n2 = medium([q[0] + PROBE * d[0], q[1] + PROBE * d[1]], ray.lam);
        if (Math.abs(n1 - n2) < 1e-12) { child(d, ray.Ps, ray.Pp, 'p'); break; }
        const eta = n1 / n2;
        const k = 1 - eta * eta * (1 - cos1 * cos1);
        if (k < 0) { stats.tir++; child(reflDir, ray.Ps, ray.Pp, 'R', { tir: true }); break; }
        const cos2 = Math.sqrt(k);
        const tDir = [eta * d[0] + (eta * cos1 - cos2) * nrm[0], eta * d[1] + (eta * cos1 - cos2) * nrm[1]];
        if (partial) {
          const { Rs, Rp } = fresnel(n1, n2, cos1, cos2);
          if (ray.Ps * Rs + ray.Pp * Rp >= minP * ray.P0) child(reflDir, ray.Ps * Rs, ray.Pp * Rp, 'r');
          else stats.lost += ray.Ps * Rs + ray.Pp * Rp;
          child(tDir, ray.Ps * (1 - Rs), ray.Pp * (1 - Rp), 't');
        } else child(tDir, ray.Ps, ray.Pp, 't');
        break;
      }
      case 'mirror': { const R = bs.refl ?? 1; child(reflDir, ray.Ps * R, ray.Pp * R, 'r'); break; }
      case 'splitter': {
        const R = bs.R ?? 0.5, T = bs.T ?? 1 - R;
        child(reflDir, ray.Ps * R, ray.Pp * R, 'r');
        child(d, ray.Ps * T, ray.Pp * T, 't');
        break;
      }
      case 'detector': rec(bs.id, hit); stats.absorbed += P; break;
      case 'blocker': stats.absorbed += P; break;
      case 'grating': {
        // 光栅面切向 tg；入射方向在切向的分量即 sinθᵢ；各级次 sinθₘ = sinθᵢ + mλ/d，出射在透射一侧
        const tg = [-nrm[1], nrm[0]], fw = [-nrm[0], -nrm[1]];
        const sIn = v2.dot(d, tg), eff = bs.eff ?? 0.8;
        for (const o of gratingOrders(sIn, ray.lam, bs.lpm, bs.duty ?? 0.5, bs.maxOrder ?? 6)) {
          const c = Math.sqrt(1 - o.s * o.s);
          const out = [o.s * tg[0] + c * fw[0], o.s * tg[1] + c * fw[1]];
          child(out, ray.Ps * o.w * eff, ray.Pp * o.w * eff, 'm' + o.m, { order: o.m });
        }
        break;
      }
      case 'ideal': case 'idealMirror': {
        // 理想透镜：与入射光线平行、过光心的光线交后焦面于 Q，出射光线射向 Q（f<0 时为从 Q 发出）
        const ax = v2.dot(bs.axis, d) >= 0 ? bs.axis : v2.mul(bs.axis, -1);
        const cu = v2.dot(d, ax);
        if (Math.abs(cu) < 1e-9) { child(d, ray.Ps, ray.Pp, 'p'); break; }
        const f = bs.f;
        const Q = v2.add(bs.c, v2.mul(d, f / cu));
        let out = f > 0 ? v2.sub(Q, q) : v2.sub(q, Q);
        if (v2.dot(out, ax) < 0) out = v2.mul(out, -1);
        if (bs.kind === 'idealMirror') { const c = v2.dot(out, ax); out = v2.sub(out, v2.mul(ax, 2 * c)); }
        const T = bs.T ?? 1;
        child(out, ray.Ps * T, ray.Pp * T, 'i');
        break;
      }
      default: stats.absorbed += P;
    }
  }
  stats.segs = segs.length;
  return { segs, hits, stats, images: findImages(segs, opts) };
}

// ---------------------------------------------------------------- 像点检测
/**
 * 同一光源、同一路径（经过的面与反射/透射次序相同）、同一波长的相邻光线两两求交，
 * 交点的中位数作为像点，交点到中位数距离的中位数作为弥散半径。
 * 交点在光线段起点之后、终点之前：实像；在起点之前（光线反向延长线的交点）：虚像；在终点之后：虚物（光线被下一元件截住）。
 */
export function findImages(segs, opts = {}) {
  const groups = new Map();
  for (const s of segs) {
    if (s.depth === 0 && !opts.imageAtSource) continue;
    const k = s.src + '|' + s.lam + '|' + s.sig;
    let g = groups.get(k); if (!g) groups.set(k, (g = []));
    g.push(s);
  }
  const out = [];
  for (const [, g] of groups) {
    if (g.length < 3) continue;
    g.sort((a, b) => a.fan - b.fan);
    // 相邻光线两两求交；靠近光束中心的一半光线对给出近轴像点（边缘光线受球差影响大，单独计入弥散）
    const pairs = [];
    for (let i = 1; i < g.length; i++) {
      const A = g[i - 1], B = g[i];
      if (B.fan - A.fan !== 1) continue;
      const da = v2.sub(A.b, A.a), db = v2.sub(B.b, B.a);
      const la = v2.len(da), lb = v2.len(db);
      if (la < 1e-9 || lb < 1e-9) continue;
      const ua = v2.mul(da, 1 / la), ub = v2.mul(db, 1 / lb);
      const den = v2.cross(ua, ub);
      if (Math.abs(den) < 1e-7) continue; // 平行：像在无穷远
      const w = v2.sub(B.a, A.a);
      const t = v2.cross(w, ub) / den;
      pairs.push({ x: v2.add(A.a, v2.mul(ua, t)), t: t / la, fan: A.fan + 0.5, rel: (A.rel + B.rel) / 2 });
    }
    if (pairs.length < 2) continue;
    const med = (arr) => { const a = arr.slice().sort((x, y) => x - y); return a[a.length >> 1]; };
    const fc = med(pairs.map((q) => q.fan));
    pairs.sort((a, b) => Math.abs(a.fan - fc) - Math.abs(b.fan - fc));
    const core = pairs.slice(0, Math.max(2, Math.ceil(pairs.length / 2)));
    const c = [med(core.map((q) => q.x[0])), med(core.map((q) => q.x[1]))];
    const spread = med(core.map((q) => Math.hypot(q.x[0] - c[0], q.x[1] - c[1])));
    const blur = Math.max(...pairs.map((q) => Math.hypot(q.x[0] - c[0], q.x[1] - c[1])));
    const tm = med(core.map((q) => q.t));
    const type = tm < 0 ? 'virtual' : tm <= 1 ? 'real' : 'vobject';
    // 只有足够“会聚”的才算像：近轴光线交点的离散不超过到光线段起点距离的 2%（或 0.3 mm）
    const dist = Math.hypot(c[0] - g[0].a[0], c[1] - g[0].a[1]);
    if (spread > Math.max(0.3, 0.02 * dist)) continue;
    out.push({ p: c, spread, blur, type, lam: g[0].lam, src: g[0].src, sig: g[0].sig, n: pairs.length, rel: med(pairs.map((q) => q.rel)), nMed: g[0].n, final: g.filter((x) => x.final).length * 2 >= g.length });
  }
  return out;
}

/** 探测器上的辐照度分布：落点按位置分 bins 份，返回每份的功率与按波长合成的颜色权重 */
export function irradiance(hitList, L, bins = 200) {
  const P = new Float64Array(bins), lamW = new Float64Array(bins);
  let tot = 0, cx = 0;
  for (const h of hitList || []) {
    const i = Math.min(bins - 1, Math.max(0, Math.floor(h.s * bins)));
    P[i] += h.P; lamW[i] += h.P * h.lam; tot += h.P; cx += h.P * h.s * L;
  }
  return { P, lam: lamW.map((v, i) => (P[i] > 0 ? v / P[i] : 0)), total: tot, centroid: tot > 0 ? cx / tot : null };
}
