// 光路设计台、真实透镜、衍射工作台的物理验证：node tests/physics-tools.mjs
// 用解析公式或独立的近轴逐面计算检验二维光线追迹、精确透镜追迹和标量衍射数值计算。
import { traceScene } from '../src/physics/rays2d.js';
import { compile, makeElement as E } from '../src/bench/elements.js';
import { paraxial } from '../src/physics/lensTrace.js';
import { index } from '../src/physics/glassdb.js';
import { spotOnScreen } from '../src/physics/realLens.js';
import * as W from '../src/physics/wavefield.js';

let fails = 0, passes = 0;
function check(name, ok, detail = '') { if (ok) passes++; else { fails++; console.log(`✗ ${name}  ${detail}`); } }
const near = (name, got, want, tol) => check(name, Math.abs(got - want) <= tol, `得到 ${got}，应为 ${want}（允差 ${tol}）`);

// ---------- 1. 玻璃库 ----------
near('K9（H-K9L）n_d', index('K9', 587.56), 1.5168, 2e-5);
near('ZF1（H-ZF1）n_d', index('ZF1', 587.56), 1.64769, 2e-5);
near('水 n_d', index('Water', 587.56), 1.333, 3e-4);

// ---------- 2. 二维光线追迹 ----------
{
  // 近轴平行光经 K9 双凸透镜的焦点 = 逐面近轴计算的后焦点
  const r = traceScene({ ...compile([E('beam', { x: -100, w: 2, n: 9, lam: 587.56 }), E('lens', { x: 0, R1: 100, R2: -100, d: 6, D: 40, mat: 'K9' })]), opts: { partial: false } });
  const par = paraxial({ epd: 2, field: 0, surfaces: [{ R: 100, t: 6, glass: 'K9', stop: true }, { R: -100, t: 100, glass: 'air' }] }, 587.56);
  const foc = r.images.find((i) => i.type === 'real');
  near('追迹焦点 = 近轴后焦点', foc ? foc.p[0] : NaN, 3 + par.bfl, 0.02);
}
{
  // 三棱镜最小偏向角：δ = 2 arcsin(n sin(A/2)) − A
  const n = index('ZF1', 589.3), A = Math.PI / 3, dmin = 2 * Math.asin(n * Math.sin(A / 2)) - A, i1 = (dmin + A) / 2, dir = -Math.PI / 6 + i1;
  const r = traceScene({ ...compile([E('prism', { A: 60, a: 40, mat: 'ZF1' }), E('laser', { x: -10 - 80 * Math.cos(dir), y: 5.77 - 80 * Math.sin(dir), rot: (dir * 180) / Math.PI, lam: 589.3 })]), opts: { partial: false } });
  const last = r.segs[r.segs.length - 1], out = Math.atan2(last.b[1] - last.a[1], last.b[0] - last.a[0]);
  near('三棱镜最小偏向角', dir - out, dmin, 1e-9);
}
{
  // 平板玻璃：正入射多次反射求和后的透过率 (1−R)/(1+R)
  const r = traceScene({ ...compile([E('laser', { x: -50, lam: 587.56 }), E('block', { w: 20, h: 60, mat: 'K9' }), E('detector', { x: 40 })]), opts: { partial: true, minP: 1e-12, maxDepth: 30 } });
  const nk = index('K9', 587.56), R0 = ((nk - 1) / (nk + 1)) ** 2;
  near('平板透过率（多次反射）', [...r.hits.values()][0].reduce((a, h) => a + h.P, 0), (1 - R0) / (1 + R0), 1e-6);
}
{
  // 布儒斯特角入射：p 分量无反射
  const n = index('K9', 632.8), tb = Math.atan(n);
  const r = traceScene({ ...compile([E('laser', { x: -50 * Math.cos(tb), y: 50 * Math.sin(tb), rot: -(tb * 180) / Math.PI, lam: 632.8 }), E('block', { x: 30, w: 60, h: 60, mat: 'K9', rot: 0 })]), opts: { partial: true, minP: 1e-12, maxDepth: 2 } });
  void r;
  const { fresnel } = await import('../src/physics/rays2d.js');
  const c2 = Math.cos(Math.asin(Math.sin(tb) / n));
  near('布儒斯特角 R_p = 0', fresnel(1, n, Math.cos(tb), c2).Rp, 0, 1e-12);
}
for (const lam of [656.3, 430]) {
  // 主虹角：一次内反射的最小偏向（笛卡儿），与追迹得到的出射光最大偏转角比较
  const nw = index('Water', lam);
  const ci = Math.sqrt((nw * nw - 1) / 3), ti = Math.acos(ci), tr = Math.asin(Math.sin(ti) / nw);
  const theory = ((4 * tr - 2 * ti) * 180) / Math.PI;
  const rr = traceScene({ ...compile([E('beam', { x: -60, w: 39.99, n: 3000, lam }), E('circle', { r: 20, mat: 'Water' })]), opts: { partial: true } });
  let mx = 0;
  for (const sg of rr.segs) if (sg.end && sg.sig.split(';').length === 4 && /t;$/.test(sg.sig) && /r;/.test(sg.sig)) mx = Math.max(mx, (Math.atan2(Math.abs(sg.b[1] - sg.a[1]), -(sg.b[0] - sg.a[0])) * 180) / Math.PI);
  near(`主虹角 ${lam} nm`, mx, theory, 0.05);
}
{
  // 光栅方程 d sinθ = mλ
  const r = traceScene({ ...compile([E('laser', { x: -30, lam: 632.8 }), E('grating', { lpm: 600, maxOrder: 1 })]), opts: { partial: false } });
  const s1 = r.segs.filter((s) => s.depth === 1).map((s) => Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]));
  near('光栅一级衍射角', Math.max(...s1), Math.asin(600 * 632.8e-6), 1e-9);
}
{
  // 理想透镜：物距 u、像距 v 满足 1/u + 1/v = 1/f
  const r = traceScene({ ...compile([E('point', { x: -150, y: 4, cone: 6, n: 21, lam: 550 }), E('ideal', { f: 50, D: 40 })]), opts: { partial: false } });
  const im = r.images.find((i) => i.type === 'real');
  near('理想透镜像距', im ? im.p[0] : NaN, 75, 1e-6);
  near('理想透镜放大率', im ? im.p[1] : NaN, -2, 1e-6);
}

// ---------- 3. 真实透镜：球差与色差 ----------
{
  const L = { R1: 15.38, R2: -15.38, t: 0.62, glass: 'K9' };
  const best = (D) => { let m = Infinity; for (let d2 = 25; d2 < 32; d2 += 0.02) m = Math.min(m, spotOnScreen({ ...L, D }, 29.7, d2)[1].rms); return m; };
  check('光阑口径减小，最佳弥散减小', best(1.5) < best(2.5) && best(2.5) < best(4));
  // 轴向色差：蓝光（470 nm）的最佳像面比红光（615 nm）更靠近透镜
  const focus = (ch) => { let m = Infinity, at = 0; for (let d2 = 25; d2 < 34; d2 += 0.01) { const r = spotOnScreen({ ...L, D: 1.5 }, 29.7, d2)[ch].rms; if (r < m) { m = r; at = d2; } } return at; };
  check('轴向色差：蓝光焦面在红光之前', focus(2) < focus(0) - 0.1, `蓝 ${focus(2)}，红 ${focus(0)}`);
}

// ---------- 4. 标量衍射 ----------
{
  const lam = 632.8e-6;
  for (const NF of [1, 2, 3]) {
    const { F } = W.propagate(W.circAperture(W.begin(256, 6, lam), 1), 1 / (lam * NF));
    near(`圆孔轴上光强（${NF} 个半波带）`, W.intensity(F)[128 * 256 + 128], 4 * Math.sin((Math.PI * NF) / 2) ** 2, 0.03);
  }
  const N = 512, R = 0.25, z = 2000;
  const { F, method } = W.propagate(W.circAperture(W.begin(N, (N * 2 * R) / 16, lam), R), z);
  const I = W.intensity(F), c = (N / 2) * N + N / 2;
  let j = 1; while (j < N / 2 - 1 && !(I[c + j] < I[c + j - 1] && I[c + j] < I[c + j + 1])) j++;
  check('远场使用菲涅耳变换', method === 'fresnel');
  near('艾里斑第一暗环 1.22λz/D', j * F.dx, (1.22 * lam * z) / (2 * R), F.dx);
  near('艾里斑中心光强 (πR²/λz)²', I[c], ((Math.PI * R * R) / (lam * z)) ** 2, 0.002);
  const z2 = 500, L2 = Math.sqrt(N * lam * z2) * 1.05;
  const G = W.mask(W.begin(N, L2, lam), (x) => (x >= 0 && x < L2 * 0.42 ? 1 : 0), 3);
  const Ie = W.intensity(W.angularSpectrum(G, z2));
  near('直边衍射：阴影边界 I₀/4', Ie[c], 0.25, 0.015);
  let mx = 0; for (let k = 0; k < N / 5; k++) mx = Math.max(mx, Ie[c + k]);
  near('直边衍射：第一极大 1.37 I₀', mx, 1.37, 0.02);
}

console.log(fails ? `\n工具物理验证：${fails} 项未通过，${passes} 项通过` : `工具物理验证：全部 ${passes} 项通过`);
process.exit(fails ? 1 : 0);
