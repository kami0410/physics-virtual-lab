// 二维非顺序光线追迹引擎（几何光学，单位 mm，y 轴向上）
//
// 每条光线带波长、偏振态（斯托克斯矢量）和“来自哪条光源光线（fan）”的编号，与场景中的面逐次求交：
//   玻璃界面：矢量斯涅耳定律 + 菲涅耳公式的穆勒矩阵（部分反射、布儒斯特角起偏、全反射时 s/p 的相位差），
//            折射率按材料的 Sellmeier 色散随波长变化。
//   单轴晶体（方解石）：入射光分成 o 光（垂直纸面振动）与 e 光（纸面内振动），e 光按折射率椭球解波矢，沿能流方向传播（双折射）。
//   偏振片、波片、偏振分束面。
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
  return { Rs: rs * rs, Rp: rp * rp, rs, rp };
}

// ---- 偏振：斯托克斯矢量 S = [S0, S1, S2, S3]
// 二维追迹里所有面的法线都在纸面内，所以 s 方向恒为垂直纸面的 ẑ，p 方向为 ẑ × d（纸面内、垂直于光线）。
// 这组基矢对每条光线都是确定的，S1 = I_s − I_p，S2、S3 由 E_s·E_p* 的实部、虚部给出；
// 各元件的作用写成穆勒矩阵直接相乘，不需要旋转参考系。
/** 振幅系数 a（s 分量）、b（p 分量）为复数 [re, im]，k 为功率换算因子（透射时为 n₂cosθ₂ / n₁cosθ₁） */
export function jonesDiag(S, a, b, k = 1) {
  const aa = a[0] * a[0] + a[1] * a[1], bb = b[0] * b[0] + b[1] * b[1];
  const cr = a[0] * b[0] + a[1] * b[1], ci = a[1] * b[0] - a[0] * b[1]; // a·conj(b)
  return [
    (k * ((aa + bb) * S[0] + (aa - bb) * S[1])) / 2,
    (k * ((aa - bb) * S[0] + (aa + bb) * S[1])) / 2,
    k * (cr * S[2] - ci * S[3]),
    k * (ci * S[2] + cr * S[3]),
  ];
}
const scaleS = (S, k) => [S[0] * k, S[1] * k, S[2] * k, S[3] * k];
/** 理想线偏振器：透光轴与 s（垂直纸面）成 α，朝 p 方向为正；T 为主透过率 */
export function polarizerS(S, alpha, T = 1) {
  const c = Math.cos(2 * alpha), s = Math.sin(2 * alpha);
  const I = (S[0] + c * S[1] + s * S[2]) / 2;
  return [T * I, T * I * c, T * I * s, 0];
}
/** 线性相位延迟器（波片）：快轴与 s 成 θ，相位延迟 δ（弧度） */
export function retarderS(S, theta, delta) {
  const c = Math.cos(2 * theta), s = Math.sin(2 * theta), cd = Math.cos(delta), sd = Math.sin(delta);
  const [S0, S1, S2, S3] = S;
  return [
    S0,
    (c * c + s * s * cd) * S1 + c * s * (1 - cd) * S2 - s * sd * S3,
    c * s * (1 - cd) * S1 + (s * s + c * c * cd) * S2 + c * sd * S3,
    s * sd * S1 - c * sd * S2 + cd * S3,
  ];
}
/** 偏振度、方位角 ψ（与 s 的夹角）、椭圆率角 χ */
export function polState(S) {
  const I = S[0] || 1e-300, L = Math.hypot(S[1], S[2]);
  return { dop: Math.min(1, Math.hypot(L, S[3]) / I), psi: 0.5 * Math.atan2(S[2], S[1]), chi: 0.5 * Math.atan2(S[3], L) };
}
/** 光源的偏振：'unpol' 自然光，'lin' 线偏振（angle：与 s 的夹角，弧度），'rcp' / 'lcp' 圆偏振（S3 > 0 记为右旋） */
export function stokesOf(pol, angle = 0, P = 1) {
  if (pol === 'lin') return [P, P * Math.cos(2 * angle), P * Math.sin(2 * angle), 0];
  if (pol === 'rcp') return [P, 0, 0, P];
  if (pol === 'lcp') return [P, 0, 0, -P];
  return [P, 0, 0, 0];
}

// ---- 单轴晶体（方解石），Sellmeier 系数：G. Ghosh, Opt. Commun. 163, 95 (1999)
export function calciteIndex(lamNm) {
  const l2 = (lamNm / 1000) ** 2;
  const no = Math.sqrt(1.73358749 + (0.96464345 * l2) / (l2 - 1.94325203e-2) + (1.82831454 * l2) / (l2 - 120));
  const ne = Math.sqrt(1.35859695 + (0.8242783 * l2) / (l2 - 1.06689543e-2) + (0.14429128 * l2) / (l2 - 120));
  return { no, ne };
}
/**
 * 非常光（e 光）：给定界面单位法线 N（指向晶体内部）、切向 T 和波矢切向分量 kt（以真空波数为单位），
 * 解 k_a²/n_o² + k_b²/n_e² = 1（a 为光轴方向，b 为纸面内垂直于光轴的方向）得到晶体内的波矢 k；
 * 光线（能流）方向 S ∝ (k_a/n_o²)·a + (k_b/n_e²)·b，与 k 不平行（离散角）。无解时返回 null。
 * sign：+1 取沿 N 前进的解，−1 取反射回去的解。
 */
export function eWave(N, T, kt, ax, no, ne, sign = 1) {
  const b = [-ax[1], ax[0]];
  const Ta = T[0] * ax[0] + T[1] * ax[1], Tb = T[0] * b[0] + T[1] * b[1];
  const Na = N[0] * ax[0] + N[1] * ax[1], Nb = N[0] * b[0] + N[1] * b[1];
  // (kt·Ta + x·Na)²/no² + (kt·Tb + x·Nb)²/ne² = 1
  const A = (Na * Na) / (no * no) + (Nb * Nb) / (ne * ne);
  const B = 2 * kt * ((Ta * Na) / (no * no) + (Tb * Nb) / (ne * ne));
  const C = (kt * kt * Ta * Ta) / (no * no) + (kt * kt * Tb * Tb) / (ne * ne) - 1;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const x1 = (-B + Math.sqrt(disc)) / (2 * A), x2 = (-B - Math.sqrt(disc)) / (2 * A);
  // 能流沿 N 分量的符号决定哪一个解是“向内”的
  const flow = (x) => {
    const k = [kt * T[0] + x * N[0], kt * T[1] + x * N[1]];
    const ka = k[0] * ax[0] + k[1] * ax[1], kb = k[0] * b[0] + k[1] * b[1];
    const S = v2.norm([(ka / (no * no)) * ax[0] + (kb / (ne * ne)) * b[0], (ka / (no * no)) * ax[1] + (kb / (ne * ne)) * b[1]]);
    return { k, S, sn: S[0] * N[0] + S[1] * N[1] };
  };
  const f1 = flow(x1), f2 = flow(x2);
  return sign > 0 ? (f1.sn >= f2.sn ? f1 : f2) : (f1.sn < f2.sn ? f1 : f2);
}

/**
 * 单轴晶体中 TM（p）波的“导纳” Y = η_xx·k_y − η_xy·k_x（光轴在入射面内时 TE、TM 严格解耦）。
 * x̂ 为界面切向、ŷ 为法向，η = ε⁻¹ = â âᵀ/n_e² + b̂ b̂ᵀ/n_o²，k 以真空波数为单位。
 * 界面上 H_z 与 E_x 连续 ⇒ 反射系数由各波的 Y 决定；法向能流 ∝ |H|²·Y。各向同性介质中 Y = k_y/n²。
 */
export function tmY(k, xh, yh, ax, no, ne) {
  const b = [-ax[1], ax[0]];
  const xa = xh[0] * ax[0] + xh[1] * ax[1], ya = yh[0] * ax[0] + yh[1] * ax[1];
  const xb = xh[0] * b[0] + xh[1] * b[1], yb = yh[0] * b[0] + yh[1] * b[1];
  const hxx = (xa * xa) / (ne * ne) + (xb * xb) / (no * no), hxy = (xa * ya) / (ne * ne) + (xb * yb) / (no * no);
  return hxx * (k[0] * yh[0] + k[1] * yh[1]) - hxy * (k[0] * xh[0] + k[1] * xh[1]);
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
 *    kind: 'glass'（玻璃体的边，须带 body）| 'mirror'(refl) | 'splitter'(R) | 'pbs'（偏振分束：反射 s、透过 p）| 'blocker' | 'detector'(pass)
 *        | 'grating'(lpm, duty, eff) | 'ideal'(f, c, axis) | 'idealMirror'(f, c, axis)
 *        | 'polarizer'(alpha, T) | 'waveplate'(theta, waves, lam0)：alpha/theta 为与 s 的夹角，朝元件线方向 u 为正
 *    可选 nrmFn(q) 给出解析法线（抛物面镜用）；gid：同一个物理面拆成多段时共用的编号（找像时视为同一面）
 *  bodies:   [{ id, obj, material, geoms, axis? }]，后加入的在上层；material 为 'calcite' 时是单轴晶体，axis 为纸面内光轴方向（弧度）
 *  rays:     [{ p, d, lam, P 或 S, src, fan }]，同一光源的光线按 fan 依次排列（相邻 fan 的光线在空间上相邻）
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
    if (n === undefined) { n = mat === 'calcite' ? calciteIndex(lam).no : glassIndex(mat, lam); nCache.set(k, n); }
    return n;
  };
  const bodyAt = (pt) => { for (let i = bodies.length - 1; i >= 0; i--) if (inside(bodies[i], pt)) return bodies[i]; return null; };
  const isXtal = (b) => !!b && b.material === 'calcite';
  const axisOf = (b) => [Math.cos(b.axis || 0), Math.sin(b.axis || 0)];
  /** 光线在某介质中的折射率：各向同性介质直接取；晶体中 o 光取 n_o，e 光取 |k| */
  const nIn = (b, ray) => {
    if (!b) return nOf(opts.ambient, ray.lam);
    if (!isXtal(b)) return nOf(b.material, ray.lam);
    if (ray.mode === 'e' && ray.k) return Math.hypot(ray.k[0], ray.k[1]);
    return calciteIndex(ray.lam).no;
  };

  const segs = [], hits = new Map(), stats = { segs: 0, lost: 0, tir: 0, cut: false, absorbed: 0, escaped: 0 };
  const rec = (id, h) => { let a = hits.get(id); if (!a) hits.set(id, (a = [])); a.push(h); };
  // 透明探测器（测量线）不打断光线：单独作为“探针”，在每段光线上检查是否穿过
  const solid = surfaces.filter((s) => !(s.kind === 'detector' && s.pass));
  const probes = surfaces.filter((s) => s.kind === 'detector' && s.pass);
  const stack = [];
  for (let i = rays.length - 1; i >= 0; i--) {
    const r = rays[i];
    const P = r.S ? r.S[0] : r.P ?? 1;
    const S = r.S ? r.S.slice() : r.Ps != null ? [r.Ps + r.Pp, r.Ps - r.Pp, 0, 0] : [P, 0, 0, 0];
    const d = v2.norm(r.d);
    const b0 = bodyAt(r.p);
    const ray = { p: r.p, d, lam: r.lam ?? 589.3, S, P0: P, src: r.src ?? 0, fan: r.fan ?? i, sig: '', depth: 0, opl: 0, n: null, mode: null, k: null };
    if (isXtal(b0)) ray.mode = 'o'; // 光源放在晶体里：按 o 光处理
    stack.push(ray);
  }
  while (stack.length) {
    const ray = stack.pop();
    const S = ray.S, P = S[0];
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
    const bHere = bodyAt([ray.p[0] + PROBE * ray.d[0], ray.p[1] + PROBE * ray.d[1]]);
    const nHere = ray.n ?? nIn(bHere, ray);
    // final：这段之后光线不再被改变方向（射出场景，或落在光屏、挡板上）——观察者看到的就是这一段
    const final = !best || (best && (bs.kind === 'blocker' || (bs.kind === 'detector' && !bs.pass)));
    segs.push({ a: ray.p, b: end, P, rel: P / ray.P0, lam: ray.lam, src: ray.src, fan: ray.fan, sig: ray.sig, depth: ray.depth, n: nHere, end: !best, final, S, mode: ray.mode });
    for (const pr of probes) for (const ph of hitGeom(pr.geom, ray.p, ray.d)) if (ph.t < L) rec(pr.id, { q: ph.q, s: ph.s, P, S, lam: ray.lam, cos: Math.abs(v2.dot(ph.nrm, ray.d)), d: ray.d, src: ray.src, fan: ray.fan, opl: ray.opl + nHere * ph.t, surf: pr });
    if (!best) { stats.escaped += P; continue; }
    const q = best.q, d = ray.d;
    let nrm = bs.nrmFn ? bs.nrmFn(q) : best.nrm;
    let cos1 = -(nrm[0] * d[0] + nrm[1] * d[1]);
    if (cos1 < 0) { nrm = [-nrm[0], -nrm[1]]; cos1 = -cos1; } // 法线朝向入射一侧
    const opl = ray.opl + nHere * L;
    const child = (dir, S2, tag, extra) => stack.push({ p: q, d: v2.norm(dir), lam: ray.lam, S: S2, P0: ray.P0, src: ray.src, fan: ray.fan, sig: ray.sig + (bs.gid || bs.id) + tag + ';', depth: ray.depth + 1, opl, n: null, mode: null, k: null, ...extra });
    const reflDir = [d[0] + 2 * cos1 * nrm[0], d[1] + 2 * cos1 * nrm[1]];
    const hit = { q, s: best.s, P, S, lam: ray.lam, cos: cos1, d, src: ray.src, fan: ray.fan, opl, surf: bs };
    // 元件线方向 u 与光线 p 基矢 ẑ×d 的相对取向：光线反向穿过时，元件上的角度在光线基矢里变号
    const sideSign = () => { const g = bs.geom, u = [g.b[0] - g.a[0], g.b[1] - g.a[1]]; return -d[1] * u[0] + d[0] * u[1] >= 0 ? 1 : -1; };

    switch (bs.kind) {
      case 'glass': {
        if (bs.geom.absorb) { stats.absorbed += P; break; } // 透镜侧边：磨砂涂黑，吸收
        const b1 = bHere, b2 = bodyAt([q[0] + PROBE * d[0], q[1] + PROBE * d[1]]);
        if (b1 === b2) { child(d, S, 'p', { mode: ray.mode, k: ray.k }); break; }
        const tg = [-nrm[1], nrm[0]], inN = [-nrm[0], -nrm[1]]; // 切向；指向出射一侧的法线
        const n1 = nHere;
        // ---- 进入单轴晶体：s 分量成为 o 光、p 分量成为 e 光（光轴在纸面内时恰好如此），两束分开传播
        if (isXtal(b2) && !isXtal(b1)) {
          const { no, ne } = calciteIndex(ray.lam);
          const kt = n1 * v2.dot(d, tg);
          const Ps = (S[0] + S[1]) / 2, Pp = (S[0] - S[1]) / 2;
          // o 光：普通折射
          const ko = 1 - (n1 / no) ** 2 * (1 - cos1 * cos1);
          const c2o = Math.sqrt(Math.max(0, ko));
          const fo = fresnel(n1, no, cos1, c2o);
          if (Ps > 0 && ko >= 0) child([(n1 / no) * d[0] + ((n1 / no) * cos1 - c2o) * nrm[0], (n1 / no) * d[1] + ((n1 / no) * cos1 - c2o) * nrm[1]], [Ps * (partial ? 1 - fo.Rs : 1), Ps * (partial ? 1 - fo.Rs : 1), 0, 0], 'o', { mode: 'o' });
          // e 光：解波矢，沿能流方向传播；p 分量的反射系数用各向异性介质的严格 TM 公式
          const ew = eWave(inN, tg, kt, axisOf(b2), no, ne, 1);
          let rp = 1;
          if (ew) {
            const Yi = cos1 / n1, Yt = tmY(ew.k, tg, inN, axisOf(b2), no, ne);
            rp = (Yi - Yt) / (Yi + Yt);
            if (Pp > 0) child(ew.S, [Pp * (partial ? 1 - rp * rp : 1), -Pp * (partial ? 1 - rp * rp : 1), 0, 0], 'e', { mode: 'e', k: ew.k });
          }
          if (partial) {
            // 反射光仍在同一方向，s、p 分量相干：用振幅反射系数的穆勒矩阵，保留 S2、S3
            const R = jonesDiag(S, [ko >= 0 ? fo.rs : 1, 0], [rp, 0]);
            if (R[0] >= minP * ray.P0) child(reflDir, R, 'r'); else stats.lost += R[0];
          }
          break;
        }
        // ---- 晶体内的 e 光射向界面（出射到各向同性介质，或在界面反射）
        if (isXtal(b1) && ray.mode === 'e' && ray.k && !isXtal(b2)) {
          const { no, ne } = calciteIndex(ray.lam);
          const n2 = nIn(b2, ray);
          const kt = v2.dot(ray.k, tg);
          const back = eWave(nrm, tg, kt, axisOf(b1), no, ne, 1); // 反射的 e 光（向晶体内部）
          if (Math.abs(kt) >= n2) { // 全反射：e 光仍为 e 光（p 偏振保持在纸面内）
            stats.tir++;
            if (back) child(back.S, S, 'R', { mode: 'e', k: back.k, tir: true });
            break;
          }
          const c2 = Math.sqrt(1 - (kt / n2) ** 2);
          const out = [kt / n2 * tg[0] + c2 * inN[0], kt / n2 * tg[1] + c2 * inN[1]];
          // 严格 TM 公式：入射、反射 e 光与透射光的 H_z、E_x 连续；功率反射率按法向能流 |H|²·Y 计
          const ax = axisOf(b1), Yi = tmY(ray.k, tg, inN, ax, no, ne), Yt = c2 / n2;
          const Yr = back ? tmY(back.k, tg, inN, ax, no, ne) : -Yi;
          const r = (Yt - Yi) / (Yr - Yt), Rp = Math.min(1, (r * r * Math.abs(Yr)) / Math.abs(Yi));
          if (partial && back && P * Rp >= minP * ray.P0) child(back.S, scaleS(S, Rp), 'r', { mode: 'e', k: back.k });
          child(out, scaleS(S, partial ? 1 - Rp : 1), 't');
          break;
        }
        // ---- 各向同性界面（含晶体里的 o 光）：菲涅耳公式的穆勒矩阵，全反射时 s、p 之间产生相位差
        const n2 = isXtal(b2) ? calciteIndex(ray.lam).no : nIn(b2, ray);
        const keep = isXtal(b1) ? { mode: 'o' } : null; // 晶体内反射的 o 光仍是 o 光
        if (Math.abs(n1 - n2) < 1e-12) { child(d, S, 'p', isXtal(b2) ? { mode: 'o' } : null); break; }
        const eta = n1 / n2;
        const kk = 1 - eta * eta * (1 - cos1 * cos1);
        if (kk < 0) {
          stats.tir++;
          const kap = Math.sqrt(-kk); // 折射角余弦 = i·κ（倏逝波）
          const div = (a, b) => { const m = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / m, (a[1] * b[0] - a[0] * b[1]) / m]; };
          const rs = div([n1 * cos1, -n2 * kap], [n1 * cos1, n2 * kap]);
          const rp = div([n2 * cos1, -n1 * kap], [n2 * cos1, n1 * kap]);
          child(reflDir, jonesDiag(S, rs, rp), 'R', { tir: true, ...keep });
          break;
        }
        const cos2 = Math.sqrt(kk);
        const tDir = [eta * d[0] + (eta * cos1 - cos2) * nrm[0], eta * d[1] + (eta * cos1 - cos2) * nrm[1]];
        const into = isXtal(b2) ? { mode: 'o' } : null;
        if (partial) {
          const { rs, rp } = fresnel(n1, n2, cos1, cos2);
          const R = jonesDiag(S, [rs, 0], [rp, 0]);
          if (R[0] >= minP * ray.P0) child(reflDir, R, 'r', keep); else stats.lost += R[0];
          const ts = (2 * n1 * cos1) / (n1 * cos1 + n2 * cos2), tp = (2 * n1 * cos1) / (n2 * cos1 + n1 * cos2);
          child(tDir, jonesDiag(S, [ts, 0], [tp, 0], (n2 * cos2) / (n1 * cos1)), 't', into);
        } else child(tDir, S, 't', into);
        break;
      }
      case 'mirror': { const r = Math.sqrt(bs.refl ?? 1); child(reflDir, jonesDiag(S, [-r, 0], [r, 0]), 'r'); break; }
      case 'splitter': {
        const R = bs.R ?? 0.5, T = bs.T ?? 1 - R;
        child(reflDir, jonesDiag(S, [-Math.sqrt(R), 0], [Math.sqrt(R), 0]), 'r');
        child(d, scaleS(S, T), 't');
        break;
      }
      case 'pbs': { // 偏振分束面：s 分量全部反射，p 分量全部透过
        const Ps = (S[0] + S[1]) / 2, Pp = (S[0] - S[1]) / 2;
        if (Ps > 0) child(reflDir, [Ps, Ps, 0, 0], 'r');
        if (Pp > 0) child(d, [Pp, -Pp, 0, 0], 't');
        break;
      }
      case 'polarizer': {
        const out = polarizerS(S, sideSign() * (bs.alpha || 0), bs.T ?? 1);
        stats.absorbed += P - out[0];
        child(d, out, 'z');
        break;
      }
      case 'waveplate': {
        // 零级波片：相位延迟 δ = 2π·(延迟量/λ)，延迟量 = waves·lam0（随波长近似不变）
        const delta = (2 * Math.PI * (bs.waves ?? 0.25) * (bs.lam0 ?? 589.3)) / ray.lam;
        child(d, retarderS(S, sideSign() * (bs.theta || 0), delta), 'w');
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
          child(out, scaleS(S, o.w * eff), 'm' + o.m, { order: o.m });
        }
        break;
      }
      case 'ideal': case 'idealMirror': {
        // 理想透镜：与入射光线平行、过光心的光线交后焦面于 Q，出射光线射向 Q（f<0 时为从 Q 发出）
        const ax = v2.dot(bs.axis, d) >= 0 ? bs.axis : v2.mul(bs.axis, -1);
        const cu = v2.dot(d, ax);
        if (Math.abs(cu) < 1e-9) { child(d, S, 'p'); break; }
        const f = bs.f;
        const Q = v2.add(bs.c, v2.mul(d, f / cu));
        let out = f > 0 ? v2.sub(Q, q) : v2.sub(q, Q);
        if (v2.dot(out, ax) < 0) out = v2.mul(out, -1);
        if (bs.kind === 'idealMirror') { const c = v2.dot(out, ax); out = v2.sub(out, v2.mul(ax, 2 * c)); }
        child(out, scaleS(S, bs.T ?? 1), 'i');
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
