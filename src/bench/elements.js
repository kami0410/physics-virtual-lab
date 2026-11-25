// 光路设计台的元件库：每种元件由参数生成引擎需要的面、玻璃体与光线，以及绘图用的形状。
// 局部坐标：光轴沿 +x，元件中心在原点；摆放时先转 rot（度，逆时针）再平移到 (x, y)。单位 mm。
import { makeBody, v2, stokesOf } from '../physics/rays2d.js';
import { LENSES, autoSemiDiameters } from '../physics/lensTrace.js';

const D2R = Math.PI / 180;
export const WHITE = [420, 445, 470, 495, 520, 545, 570, 595, 620, 645, 670, 695];

const sag = (R, h) => (!isFinite(R) ? 0 : R - Math.sign(R) * Math.sqrt(Math.max(0, R * R - h * h)));

/** 坐标变换器 */
function frame(el) {
  const th = (el.rot || 0) * D2R, c = Math.cos(th), s = Math.sin(th);
  const P = (x, y) => [el.x + x * c - y * s, el.y + x * s + y * c];
  const D = (x, y) => [x * c - y * s, x * s + y * c];
  return { P, D, th };
}

/** 透镜的一个球面（或平面）作为边界边：顶点 xv，曲率半径 R，半口径 h，dirUp：沿边界由下到上(true)/由上到下 */
function lensEdge(F, xv, R, h, dirUp) {
  if (!isFinite(R) || Math.abs(R) > 1e6) {
    const a = F.P(xv, dirUp ? -h : h), b = F.P(xv, dirUp ? h : -h);
    return { type: 'line', a, b };
  }
  const cx = xv + R, mid = R > 0 ? Math.PI : 0;
  const phi = Math.asin(Math.min(1, h / Math.abs(R)));
  // 顶点在 mid 方向；y = +h 的端点角度：R>0 时为 π − φ，R<0 时为 +φ
  const aTop = R > 0 ? mid - phi : mid + phi, aBot = R > 0 ? mid + phi : mid - phi;
  const from = (dirUp ? aBot : aTop) + F.th, to = (dirUp ? aTop : aBot) + F.th;
  return { type: 'arc', c: F.P(cx, 0), r: Math.abs(R), from, to };
}

/** 由一串透镜面（R、到下一面距离 t、面后的玻璃）生成若干相邻玻璃体（胶合面重合） */
function lensStack(F, surfs, h, x0) {
  const bodies = [];
  let x = x0;
  const xs = [];
  for (const s of surfs) { xs.push(x); x += s.t || 0; }
  for (let i = 0; i < surfs.length - 1; i++) {
    const mat = surfs[i].glass;
    if (!mat || mat === 'air') continue;
    const R1 = surfs[i].R, R2 = surfs[i + 1].R, xa = xs[i], xb = xs[i + 1];
    // 边缘厚度不能为负：必要时缩小口径
    let hh = h[i] ?? h;
    if (typeof h === 'number') hh = h;
    for (let k = 0; k < 40; k++) {
      const ef = xa + sag(R1, hh), eb = xb + sag(R2, hh);
      if (eb - ef > 0.05 * (xb - xa) && (!isFinite(R1) || hh < Math.abs(R1)) && (!isFinite(R2) || hh < Math.abs(R2))) break;
      hh *= 0.95;
    }
    const ef = xa + sag(R1, hh), eb = xb + sag(R2, hh);
    const edges = [
      lensEdge(F, xa, R1, hh, false), // 前表面：上 → 下
      { type: 'line', a: F.P(ef, -hh), b: F.P(eb, -hh), rim: true },
      lensEdge(F, xb, R2, hh, true), // 后表面：下 → 上
      { type: 'line', a: F.P(eb, hh), b: F.P(ef, hh), rim: true },
    ];
    bodies.push({ material: mat, edges, h: hh });
  }
  return bodies;
}

/** 光源光线 */
function sourceRays(el, F, kind) {
  const lams = el.white ? WHITE : [el.lam];
  const rays = [];
  const P0 = (el.power ?? 1) / lams.length;
  // 偏振角在光线自己的 s/p 基矢里定义（s 垂直纸面，p = ẑ × d），对每条光线都相同
  const S = (P) => stokesOf(el.pol || 'unpol', (el.polAng || 0) * D2R, P);
  for (const lam of lams) {
    if (kind === 'laser') rays.push({ p: F.P(0, 0), d: F.D(1, 0), lam, S: S(P0) });
    else if (kind === 'beam') {
      const n = Math.max(1, Math.round(el.n));
      for (let i = 0; i < n; i++) {
        const y = n === 1 ? 0 : -el.w / 2 + (el.w * i) / (n - 1);
        const a = (el.div || 0) * D2R * (n === 1 ? 0 : (2 * i) / (n - 1) - 1);
        rays.push({ p: F.P(0, y), d: F.D(Math.cos(a), Math.sin(a)), lam, S: S(P0 / n) });
      }
    } else if (kind === 'point') {
      const n = Math.max(1, Math.round(el.n));
      const cone = Math.min(360, el.cone) * D2R;
      const full = cone >= TAU_EPS;
      for (let i = 0; i < n; i++) {
        const a = full ? (TAU * i) / n : -cone / 2 + (cone * (i + 0.5)) / n;
        rays.push({ p: F.P(0, 0), d: F.D(Math.cos(a), Math.sin(a)), lam, S: S(P0 / n) });
      }
    }
  }
  return rays;
}
const TAU = Math.PI * 2, TAU_EPS = TAU - 1e-6;

const glassParam = { k: 'mat', label: '材料', type: 'glass' };
const lamParams = [
  { k: 'white', label: '白光', type: 'bool' },
  { k: 'lam', label: '波长', unit: 'nm', min: 380, max: 760, step: 0.1, hideIf: (e) => e.white },
  { k: 'pol', label: '偏振', type: 'select', options: () => [['unpol', '自然光'], ['lin', '线偏振'], ['rcp', '右旋圆偏振'], ['lcp', '左旋圆偏振']] },
  { k: 'polAng', label: '振动方向', unit: '°', step: 1, hideIf: (e) => e.pol !== 'lin', hint: '与垂直纸面方向（s）的夹角：0° 垂直纸面，90° 在纸面内（p）' },
];
const polDefaults = { pol: 'unpol', polAng: 0 };

// ---------------------------------------------------------------- 元件定义
export const TYPES = {
  laser: {
    label: '激光器', group: '光源', defaults: { lam: 632.8, white: false, power: 1, ...polDefaults },
    params: [...lamParams],
    build(el, F) { return { rays: sourceRays(el, F, 'laser'), shapes: [{ kind: 'source', src: 'laser' }] }; },
  },
  beam: {
    label: '平行光束', group: '光源', defaults: { lam: 589.3, white: false, w: 30, n: 15, div: 0, power: 1, ...polDefaults },
    params: [...lamParams, { k: 'w', label: '光束宽度', unit: 'mm', min: 0, max: 400, step: 0.5 }, { k: 'n', label: '光线数', min: 1, max: 400, step: 1 }, { k: 'div', label: '发散半角', unit: '°', min: 0, max: 30, step: 0.1 }],
    build(el, F) { return { rays: sourceRays(el, F, 'beam'), shapes: [{ kind: 'source', src: 'beam', geom: { type: 'line', a: F.P(0, -el.w / 2), b: F.P(0, el.w / 2) } }] }; },
  },
  point: {
    label: '点光源', group: '光源', defaults: { lam: 589.3, white: false, n: 36, cone: 360, power: 1, ...polDefaults },
    params: [...lamParams, { k: 'n', label: '光线数', min: 1, max: 720, step: 1 }, { k: 'cone', label: '发光角', unit: '°', min: 0.1, max: 360, step: 0.5 }],
    build(el, F) { return { rays: sourceRays(el, F, 'point'), shapes: [{ kind: 'source', src: 'point' }] }; },
  },
  lens: {
    label: '球面透镜', group: '透镜', defaults: { R1: 100, R2: -100, d: 6, D: 40, mat: 'K9' },
    params: [{ k: 'R1', label: '前表面半径 R₁', unit: 'mm', step: 1, hint: '∞ 写 0' }, { k: 'R2', label: '后表面半径 R₂', unit: 'mm', step: 1, hint: '∞ 写 0' }, { k: 'd', label: '中心厚度', unit: 'mm', min: 0.1, max: 200, step: 0.1 }, { k: 'D', label: '口径', unit: 'mm', min: 1, max: 400, step: 1 }, glassParam],
    build(el, F) {
      const R = (r) => (r === 0 ? Infinity : r);
      const bodies = lensStack(F, [{ R: R(el.R1), t: el.d, glass: el.mat }, { R: R(el.R2), t: 0, glass: 'air' }], el.D / 2, -el.d / 2);
      return { bodies };
    },
  },
  achromat: {
    label: '双胶合透镜', group: '透镜', defaults: { R1: 61.9, R2: -44.2, R3: -128.2, d1: 6, d2: 2.5, D: 30, mat1: 'K9', mat2: 'ZF2' },
    params: [{ k: 'R1', label: 'R₁', unit: 'mm', step: 0.1 }, { k: 'R2', label: 'R₂（胶合面）', unit: 'mm', step: 0.1 }, { k: 'R3', label: 'R₃', unit: 'mm', step: 0.1 }, { k: 'd1', label: '冕牌片厚', unit: 'mm', min: 0.1, step: 0.1 }, { k: 'd2', label: '火石片厚', unit: 'mm', min: 0.1, step: 0.1 }, { k: 'D', label: '口径', unit: 'mm', min: 1, step: 1 }, { k: 'mat1', label: '冕牌玻璃', type: 'glass' }, { k: 'mat2', label: '火石玻璃', type: 'glass' }],
    build(el, F) {
      const R = (r) => (r === 0 ? Infinity : r);
      const t = el.d1 + el.d2;
      return { bodies: lensStack(F, [{ R: R(el.R1), t: el.d1, glass: el.mat1 }, { R: R(el.R2), t: el.d2, glass: el.mat2 }, { R: R(el.R3), t: 0, glass: 'air' }], el.D / 2, -t / 2) };
    },
  },
  ideal: {
    label: '理想薄透镜', group: '透镜', defaults: { f: 100, D: 40 },
    params: [{ k: 'f', label: '焦距 f', unit: 'mm', step: 1 }, { k: 'D', label: '口径', unit: 'mm', min: 1, step: 1 }],
    build(el, F) {
      const geom = { type: 'line', a: F.P(0, -el.D / 2), b: F.P(0, el.D / 2) };
      return { surfaces: [{ kind: 'ideal', geom, f: el.f || 1e9, c: F.P(0, 0), axis: F.D(1, 0) }], shapes: [{ kind: 'ideal', geom, f: el.f }] };
    },
  },
  camera: {
    label: '镜头库', group: '透镜', defaults: { design: 'cooke', scale: 1 },
    params: [{ k: 'design', label: '镜头', type: 'select', options: () => CAMERA_LENSES.map((k) => [k, LENS_CN[k] || LENSES[k].name]) }, { k: 'scale', label: '缩放', min: 0.2, max: 10, step: 0.1 }],
    build(el, F) {
      const L = LENSES[el.design] || LENSES.cooke;
      const sd = semiDiam(el.design);
      const k = el.scale || 1;
      const surfs = L.surfaces.map((s) => ({ R: s.R * k, t: s.t * k, glass: s.glass }));
      // 只取到最后一个玻璃面为止的总长，镜组居中
      let len = 0; for (let i = 0; i < surfs.length - 1; i++) len += surfs[i].t;
      const bodies = [];
      let x = -len / 2;
      for (let i = 0; i < surfs.length - 1; i++) {
        if (surfs[i].glass !== 'air') bodies.push(...lensStack(F, [surfs[i], { ...surfs[i + 1], glass: 'air' }], Math.min(sd[i], sd[i + 1]) * k, x));
        x += surfs[i].t;
      }
      // 孔径光阑
      const shapes = [];
      const surfaces = [];
      x = -len / 2;
      L.surfaces.forEach((s, i) => {
        if (s.stop && !isFinite(s.R) && s.glass === 'air') {
          const h0 = sd[i] * k, h1 = h0 * 2.2;
          for (const sg of [1, -1]) {
            const geom = { type: 'line', a: F.P(x, sg * h0), b: F.P(x, sg * h1) };
            surfaces.push({ kind: 'blocker', geom }); shapes.push({ kind: 'blocker', geom });
          }
        }
        x += surfs[i].t;
      });
      return { bodies, surfaces, shapes };
    },
  },
  mirror: {
    label: '平面镜', group: '反射镜', defaults: { L: 40, refl: 0.95, rot: 90 },
    params: [{ k: 'L', label: '长度', unit: 'mm', min: 1, step: 1 }, { k: 'refl', label: '反射率', min: 0, max: 1, step: 0.01 }],
    build(el, F) { const geom = { type: 'line', a: F.P(0, -el.L / 2), b: F.P(0, el.L / 2) }; return { surfaces: [{ kind: 'mirror', geom, refl: el.refl }], shapes: [{ kind: 'mirror', geom, back: F.D(1, 0) }] }; },
  },
  sphMirror: {
    label: '球面镜', group: '反射镜', defaults: { R: 200, D: 60, refl: 0.95 },
    params: [{ k: 'R', label: '曲率半径 R', unit: 'mm', step: 1, hint: '正：凹面朝左（−x）；负：凸面' }, { k: 'D', label: '口径', unit: 'mm', min: 1, step: 1 }, { k: 'refl', label: '反射率', min: 0, max: 1, step: 0.01 }],
    build(el, F) {
      const R = el.R || 1e9, h = Math.min(el.D / 2, Math.abs(R) * 0.999);
      const phi = Math.asin(h / Math.abs(R)), mid = R > 0 ? 0 : Math.PI;
      const c = F.P(-R, 0);
      const geom = { type: 'arc', c, r: Math.abs(R), a0: ((mid - phi + F.th) % TAU + TAU) % TAU, span: 2 * phi };
      return { surfaces: [{ kind: 'mirror', geom, refl: el.refl }], shapes: [{ kind: 'mirror', geom, back: F.D(1, 0) }] };
    },
  },
  paraMirror: {
    label: '抛物面镜', group: '反射镜', defaults: { f: 100, D: 80, refl: 0.95 },
    params: [{ k: 'f', label: '焦距', unit: 'mm', min: 1, step: 1, hint: '焦点在镜左方 f 处' }, { k: 'D', label: '口径', unit: 'mm', min: 1, step: 1 }, { k: 'refl', label: '反射率', min: 0, max: 1, step: 0.01 }],
    build(el, F) {
      // x = −y²/(4f)，焦点 (−f, 0)；用折线求交、用解析法线反射
      const N = 120, h = el.D / 2, f = el.f, surfaces = [], pts = [];
      for (let i = 0; i <= N; i++) { const y = -h + (2 * h * i) / N; pts.push([-(y * y) / (4 * f), y]); }
      const nrmFn = (q) => {
        // 世界坐标 → 局部
        const lx = (q[0] - el.x) * Math.cos(F.th) + (q[1] - el.y) * Math.sin(F.th);
        const ly = -(q[0] - el.x) * Math.sin(F.th) + (q[1] - el.y) * Math.cos(F.th);
        void lx;
        return v2.norm(F.D(1, ly / (2 * f)));
      };
      for (let i = 0; i < N; i++) surfaces.push({ kind: 'mirror', geom: { type: 'line', a: F.P(...pts[i]), b: F.P(...pts[i + 1]) }, refl: el.refl, nrmFn, gid: el.id + '.pm' });
      return { surfaces, shapes: [{ kind: 'poly', pts: pts.map((p) => F.P(...p)), back: F.D(1, 0) }] };
    },
  },
  idealMirror: {
    label: '理想球面镜', group: '反射镜', defaults: { f: 100, D: 60 },
    params: [{ k: 'f', label: '焦距 f', unit: 'mm', step: 1, hint: '正为凹面镜' }, { k: 'D', label: '口径', unit: 'mm', min: 1, step: 1 }],
    build(el, F) {
      const geom = { type: 'line', a: F.P(0, -el.D / 2), b: F.P(0, el.D / 2) };
      return { surfaces: [{ kind: 'idealMirror', geom, f: el.f || 1e9, c: F.P(0, 0), axis: F.D(1, 0) }], shapes: [{ kind: 'mirror', geom, ideal: true, back: F.D(1, 0) }] };
    },
  },
  splitter: {
    label: '分束镜', group: '反射镜', defaults: { L: 30, R: 0.5, rot: 45 },
    params: [{ k: 'L', label: '长度', unit: 'mm', min: 1, step: 1 }, { k: 'R', label: '反射比', min: 0, max: 1, step: 0.01 }],
    build(el, F) { const geom = { type: 'line', a: F.P(0, -el.L / 2), b: F.P(0, el.L / 2) }; return { surfaces: [{ kind: 'splitter', geom, R: el.R }], shapes: [{ kind: 'splitter', geom }] }; },
  },
  prism: {
    label: '三棱镜', group: '玻璃', defaults: { A: 60, a: 40, mat: 'ZF1' },
    params: [{ k: 'A', label: '顶角', unit: '°', min: 1, max: 170, step: 0.1 }, { k: 'a', label: '腰长', unit: 'mm', min: 1, step: 1 }, glassParam],
    build(el, F) {
      const half = (el.A / 2) * D2R, a = el.a;
      const hgt = a * Math.cos(half), w = a * Math.sin(half);
      const yc = hgt / 3; // 重心
      const A = F.P(0, hgt - yc), B = F.P(-w, -yc), C = F.P(w, -yc);
      return { bodies: [{ material: el.mat, edges: [{ type: 'line', a: A, b: B }, { type: 'line', a: B, b: C }, { type: 'line', a: C, b: A }] }] };
    },
  },
  block: {
    label: '平板玻璃', group: '玻璃', defaults: { w: 20, h: 60, mat: 'K9' },
    params: [{ k: 'w', label: '厚度', unit: 'mm', min: 0.1, step: 0.5 }, { k: 'h', label: '高度', unit: 'mm', min: 0.1, step: 1 }, glassParam],
    build(el, F) {
      const p = [F.P(-el.w / 2, -el.h / 2), F.P(el.w / 2, -el.h / 2), F.P(el.w / 2, el.h / 2), F.P(-el.w / 2, el.h / 2)];
      return { bodies: [{ material: el.mat, edges: p.map((a, i) => ({ type: 'line', a, b: p[(i + 1) % 4] })) }] };
    },
  },
  biprism: {
    label: '菲涅耳双棱镜', group: '玻璃', defaults: { alpha: 0.5, h: 30, t: 2, mat: 'K9' },
    params: [{ k: 'alpha', label: '折射角 α', unit: '°', min: 0.05, max: 30, step: 0.05 }, { k: 'h', label: '高度', unit: 'mm', min: 1, step: 1 }, { k: 't', label: '底厚', unit: 'mm', min: 0.1, step: 0.1 }, glassParam],
    build(el, F) {
      // 平面朝 −x，棱脊在 +x 一侧的中线上；两个半棱镜各使光偏折约 (n−1)α，形成两个虚光源
      const ridge = el.t / 2 + (el.h / 2) * Math.tan(el.alpha * D2R);
      const p = [F.P(-el.t / 2, -el.h / 2), F.P(el.t / 2, -el.h / 2), F.P(ridge, 0), F.P(el.t / 2, el.h / 2), F.P(-el.t / 2, el.h / 2)];
      return { bodies: [{ material: el.mat, edges: p.map((a, i) => ({ type: 'line', a, b: p[(i + 1) % p.length] })) }] };
    },
  },
  semicircle: {
    label: '半圆柱玻璃砖', group: '玻璃', defaults: { r: 30, mat: 'K9' },
    params: [{ k: 'r', label: '半径', unit: 'mm', min: 1, step: 0.5 }, glassParam],
    build(el, F) {
      // 平面在 x = 0（朝 −x），圆弧朝 +x
      return { bodies: [{ material: el.mat, edges: [{ type: 'line', a: F.P(0, el.r), b: F.P(0, -el.r) }, { type: 'arc', c: F.P(0, 0), r: el.r, from: -Math.PI / 2 + F.th, to: Math.PI / 2 + F.th }] }] };
    },
  },
  circle: {
    label: '圆柱 / 水滴', group: '玻璃', defaults: { r: 20, mat: 'Water' },
    params: [{ k: 'r', label: '半径', unit: 'mm', min: 0.5, step: 0.5 }, glassParam],
    build(el, F) { return { bodies: [{ material: el.mat, edges: [{ type: 'arc', c: F.P(0, 0), r: el.r, from: 0, to: TAU }] }] }; },
  },
  tank: {
    label: '液槽 / 介质区', group: '玻璃', defaults: { w: 120, h: 80, mat: 'Water' },
    params: [{ k: 'w', label: '宽', unit: 'mm', min: 1, step: 1 }, { k: 'h', label: '高', unit: 'mm', min: 1, step: 1 }, glassParam],
    build(el, F) { return TYPES.block.build({ ...el, w: el.w, h: el.h }, F); },
  },
  grating: {
    label: '透射光栅', group: '其他', defaults: { L: 30, lpm: 300, duty: 0.5, eff: 0.8, maxOrder: 3 },
    params: [{ k: 'L', label: '长度', unit: 'mm', min: 1, step: 1 }, { k: 'lpm', label: '刻线密度', unit: '线/mm', min: 1, max: 3600, step: 1 }, { k: 'duty', label: '缝宽/周期', min: 0.05, max: 0.95, step: 0.01, hint: '0.5 时偶数级缺级' }, { k: 'maxOrder', label: '最高级次', min: 0, max: 10, step: 1 }, { k: 'eff', label: '透过率', min: 0, max: 1, step: 0.01 }],
    build(el, F) { const geom = { type: 'line', a: F.P(0, -el.L / 2), b: F.P(0, el.L / 2) }; return { surfaces: [{ kind: 'grating', geom, lpm: el.lpm, duty: el.duty, eff: el.eff, maxOrder: el.maxOrder }], shapes: [{ kind: 'grating', geom }] }; },
  },
  blocker: {
    label: '挡板', group: '其他', defaults: { L: 30 },
    params: [{ k: 'L', label: '长度', unit: 'mm', min: 0.1, step: 0.5 }],
    build(el, F) { const geom = { type: 'line', a: F.P(0, -el.L / 2), b: F.P(0, el.L / 2) }; return { surfaces: [{ kind: 'blocker', geom }], shapes: [{ kind: 'blocker', geom }] }; },
  },
  aperture: {
    label: '光阑', group: '其他', defaults: { L: 60, gap: 10 },
    params: [{ k: 'L', label: '外径', unit: 'mm', min: 1, step: 1 }, { k: 'gap', label: '通光孔径', unit: 'mm', min: 0, step: 0.5 }],
    build(el, F) {
      const g = Math.min(el.gap, el.L) / 2, out = [];
      for (const s of [1, -1]) out.push({ kind: 'blocker', geom: { type: 'line', a: F.P(0, s * g), b: F.P(0, s * el.L / 2) } });
      return { surfaces: out, shapes: out };
    },
  },
  polarizer: {
    label: '偏振片', group: '偏振', defaults: { L: 30, alpha: 0, T: 1 },
    params: [{ k: 'L', label: '长度', unit: 'mm', min: 1, step: 1 }, { k: 'alpha', label: '透光轴', unit: '°', step: 1, hint: '与垂直纸面方向（s）的夹角；0° 只透过 s 光，90° 只透过 p 光' }, { k: 'T', label: '主透过率', min: 0, max: 1, step: 0.01 }],
    build(el, F) { const geom = { type: 'line', a: F.P(0, -el.L / 2), b: F.P(0, el.L / 2) }; return { surfaces: [{ kind: 'polarizer', geom, alpha: el.alpha * D2R, T: el.T }], shapes: [{ kind: 'polarizer', geom, alpha: el.alpha }] }; },
  },
  waveplate: {
    label: '波片', group: '偏振', defaults: { L: 30, theta: 45, waves: 0.25, lam0: 589.3 },
    params: [{ k: 'L', label: '长度', unit: 'mm', min: 1, step: 1 }, { k: 'theta', label: '快轴', unit: '°', step: 1, hint: '与垂直纸面方向（s）的夹角' }, { k: 'waves', label: '延迟量', unit: 'λ₀', step: 0.05, hint: '0.25 为 1/4 波片，0.5 为半波片' }, { k: 'lam0', label: '设计波长 λ₀', unit: 'nm', min: 380, max: 1100, step: 0.1 }],
    build(el, F) { const geom = { type: 'line', a: F.P(0, -el.L / 2), b: F.P(0, el.L / 2) }; return { surfaces: [{ kind: 'waveplate', geom, theta: el.theta * D2R, waves: el.waves, lam0: el.lam0 }], shapes: [{ kind: 'waveplate', geom, waves: el.waves }] }; },
  },
  pbs: {
    label: '偏振分束镜', group: '偏振', defaults: { L: 30, rot: 45 },
    params: [{ k: 'L', label: '长度', unit: 'mm', min: 1, step: 1 }],
    build(el, F) { const geom = { type: 'line', a: F.P(0, -el.L / 2), b: F.P(0, el.L / 2) }; return { surfaces: [{ kind: 'pbs', geom }], shapes: [{ kind: 'pbs', geom }] }; },
  },
  calcite: {
    label: '方解石晶体', group: '偏振', defaults: { w: 30, h: 40, axis: 45 },
    params: [{ k: 'w', label: '厚度', unit: 'mm', min: 0.5, step: 0.5 }, { k: 'h', label: '高度', unit: 'mm', min: 0.5, step: 1 }, { k: 'axis', label: '光轴方向', unit: '°', step: 1, hint: '光轴在纸面内，与元件 x 轴（厚度方向）的夹角' }],
    build(el, F) {
      const p = [F.P(-el.w / 2, -el.h / 2), F.P(el.w / 2, -el.h / 2), F.P(el.w / 2, el.h / 2), F.P(-el.w / 2, el.h / 2)];
      return { bodies: [{ material: 'calcite', axis: F.th + el.axis * D2R, edges: p.map((a, i) => ({ type: 'line', a, b: p[(i + 1) % 4] })) }] };
    },
  },
  rhomb: {
    label: '菲涅耳菱体', group: '偏振', defaults: { a: 25, len: 60, ang: 54.6, mat: 'K9', rot: 0 },
    params: [{ k: 'a', label: '端面宽', unit: 'mm', min: 1, step: 0.5 }, { k: 'len', label: '长', unit: 'mm', min: 1, step: 1 }, { k: 'ang', label: '锐角', unit: '°', min: 20, max: 89, step: 0.1, hint: '光垂直端面入射后在两个斜面各全反射一次，入射角等于此角' }, glassParam],
    build(el, F) {
      // 平行四边形：两条长边沿 x，两条短边（端面）与长边成锐角 ang
      const t = Math.tan(el.ang * D2R), dx = el.a / t, L = el.len / 2;
      const p = [F.P(-L, -el.a / 2), F.P(L, -el.a / 2), F.P(L + dx, el.a / 2), F.P(-L + dx, el.a / 2)];
      return { bodies: [{ material: el.mat, edges: p.map((a, i) => ({ type: 'line', a, b: p[(i + 1) % 4] })) }] };
    },
  },
  detector: {
    label: '光屏 / 探测器', group: '其他', defaults: { L: 60, pass: false, rot: 0 },
    params: [{ k: 'L', label: '长度', unit: 'mm', min: 1, step: 1 }, { k: 'pass', label: '透明（只测量不挡光）', type: 'bool' }],
    build(el, F) {
      // 探测器坐标 s 从 a(−L/2) 到 b(+L/2)
      const geom = { type: 'line', a: F.P(0, -el.L / 2), b: F.P(0, el.L / 2) };
      return { surfaces: [{ kind: 'detector', geom, pass: el.pass, det: true }], shapes: [{ kind: 'detector', geom, back: F.D(1, 0) }] };
    },
  },
};

export const LENS_CN = {
  'plano-convex': '平凸透镜 f/5（N-BK7）', 'plano-convex-rev': '平凸透镜 f/5，平面朝物', 'plano-hyperbolic': '平—双曲面非球面透镜（无球差）', achromat: '双胶合消色差 f=100',
  cooke: '库克三片式 f/5，50 mm', 'double-gauss': '双高斯 f/3，100 mm', tessar: '天塞 Tessar', petzval: '佩茨瓦尔人像镜头', telephoto: '摄远镜头', retrofocus: '反摄远广角', biogon: '比奥贡 Biogon 广角',
};
export const CAMERA_LENSES = Object.keys(LENSES).filter((k) => !LENSES[k].surfaces.some((s) => s.glass === 'mirror'));
const sdCache = new Map();
function semiDiam(key) {
  if (!sdCache.has(key)) { const L = LENSES[key]; let sd; try { sd = autoSemiDiameters(L); } catch { sd = L.surfaces.map(() => L.epd / 2); } sdCache.set(key, sd); }
  return sdCache.get(key);
}

export const GROUPS = ['光源', '透镜', '反射镜', '玻璃', '偏振', '其他'];

let uid = 1;
export function makeElement(type, props = {}) {
  const T = TYPES[type];
  return { type, x: 0, y: 0, rot: 0, ...T.defaults, ...props, id: 'e' + uid++ };
}

/** 把元件编译成引擎输入；同时给出绘图形状 */
export function compile(elements) {
  const surfaces = [], bodies = [], rays = [], shapes = [];
  let src = 0;
  for (const el of elements) {
    const T = TYPES[el.type];
    if (!T) continue;
    const F = frame(el);
    let r;
    try { r = T.build(el, F); } catch (err) { console.error(`元件 ${el.type} 构造失败`, err); continue; }
    (r.surfaces || []).forEach((s, i) => surfaces.push({ ...s, id: el.id + '.' + i, obj: el.id }));
    (r.bodies || []).forEach((b, i) => {
      const body = { ...makeBody(b.edges), material: b.material, obj: el.id, id: el.id + '.b' + i, edges: b.edges, axis: b.axis };
      bodies.push(body);
      body.geoms.forEach((g, j) => surfaces.push({ kind: 'glass', geom: g, body, id: el.id + '.b' + i + '.' + j, obj: el.id }));
      shapes.push({ kind: 'glass', obj: el.id, edges: b.edges, material: b.material, axis: b.axis, c: F.P(0, 0) });
    });
    if (r.rays && r.rays.length) {
      const s = src++;
      r.rays.forEach((ray, i) => rays.push({ ...ray, src: s, fan: i, obj: el.id }));
    }
    for (const sh of r.shapes || []) shapes.push({ ...sh, obj: el.id, el });
  }
  return { surfaces, bodies, rays, shapes };
}
