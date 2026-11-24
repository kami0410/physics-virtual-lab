// 光路设计台、真实透镜、衍射工作台的物理验证：node tests/physics-tools.mjs
// 用解析公式或独立的近轴逐面计算检验二维光线追迹、精确透镜追迹和标量衍射数值计算。
import { traceScene } from '../src/physics/rays2d.js';
import { compile, makeElement as E } from '../src/bench/elements.js';
import { paraxial } from '../src/physics/lensTrace.js';
import { index } from '../src/physics/glassdb.js';
import { spotOnScreen } from '../src/physics/realLens.js';
import * as W from '../src/physics/wavefield.js';
import { analyse } from '../src/bench/quality.js';

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

{
  // 近焦点成像对参数极敏感：显微镜（物镜 f≈29.78、目镜 f≈51.17，目镜距中间像比焦距近 2.5 mm）的最终虚像。
  // 分享链接打包后再追迹，虚像位置仍须与薄透镜公式一致（焦距取两位小数会偏 7%）
  const { packScene, unpackScene } = await import('../src/bench/share.js');
  const f1 = 29.7762431104608, f2 = 51.17047051836502, xe = 857.0632601879199 - 636;
  const els = [E('ideal', { x: 0, f: f1, D: 12 }), E('ideal', { x: xe, f: f2, D: 20 }), E('point', { x: -36, cone: 20, n: 21, lam: 550 })];
  const back = unpackScene(JSON.parse(JSON.stringify(packScene({ els })))).els.map(({ type, ...o }) => E(type, o));
  const r = traceScene({ ...compile(back), opts: { partial: false } });
  const v1 = 1 / (1 / f1 - 1 / 36), u2 = xe - v1, v2 = 1 / (1 / f2 - 1 / u2);
  const im = r.images.find((i) => i.type === 'virtual' && i.final);
  near('显微镜最终虚像（经分享链接打包）', im ? im.p[0] : NaN, xe + v2, 0.05);
}

// ---------- 2b. 偏振（斯托克斯矢量追迹） ----------
{
  const { PRESETS } = await import('../src/bench/presets.js');
  const { polState, calciteIndex } = await import('../src/physics/rays2d.js');
  const run = (id) => {
    const P = PRESETS.find((p) => p.id === id), els = P.build(), c = compile(els);
    const r = traceScene({ ...c, opts: { partial: P.opts.partial, minP: 1e-4 } });
    const det = els.find((e) => e.type === 'detector'), hs = [];
    for (const s of c.surfaces) if (s.obj === det.id) hs.push(...(r.hits.get(s.id) || []));
    const S = [0, 0, 0, 0]; for (const h of hs) for (let i = 0; i < 4; i++) S[i] += h.S[i];
    return { S, st: polState(S), hs };
  };
  const deg = (r) => (r * 180) / Math.PI;
  const n = index('K9', 632.8), tb = Math.atan(n), t2 = Math.asin(Math.sin(tb) / n);
  const rs = (Math.cos(tb) - n * Math.cos(t2)) / (Math.cos(tb) + n * Math.cos(t2));
  const b = run('brewster');
  near('布儒斯特角反射：功率 = R_s/2', b.S[0], (rs * rs) / 2, 1e-9);
  near('布儒斯特角反射：纯 s 偏振', b.S[1] / b.S[0], 1, 1e-9);
  near('马吕斯定律 I = ½cos²60°', run('malus').S[0], 0.125, 1e-12);
  near('1/4 波片：45° 线偏振 → 圆偏振', Math.abs(deg(run('qwp').st.chi)), 45, 1e-6);
  // 菲涅耳菱体：每次全反射的相位差 tan(Δ/2) = cosθ·√(sin²θ − n²)/sin²θ（n = 1/n_glass），两次合计 Γ = 2Δ
  const th = 54.6 * Math.PI / 180, nr = 1 / n, D1 = 2 * Math.atan((Math.cos(th) * Math.sqrt(Math.sin(th) ** 2 - nr * nr)) / Math.sin(th) ** 2);
  const G = 2 * deg(D1); // 总相位差，45° 线偏振入射时 χ = ½·min(Γ, 180° − Γ)
  near('菲涅耳菱体：两次全反射的相位差', Math.abs(deg(run('rhomb').st.chi)), 0.5 * Math.min(G, 180 - G), 1e-6);
  // 方解石：光轴 45° 时 e 光离散角 tanρ = (n_o² − n_e²)/(n_o² + n_e²)
  const { no, ne } = calciteIndex(589.3), rho = Math.atan((no * no - ne * ne) / (no * no + ne * ne));
  const cc = run('calcite');
  near('方解石 o 光 n_o（589.3 nm）', no, 1.6584, 3e-4);
  near('方解石 e 光 n_e（589.3 nm）', ne, 1.4864, 3e-4);
  near('方解石双折射：两束光的横移 = 厚度·tanρ', Math.abs(cc.hs[0].q[1] - cc.hs[1].q[1]), 40 * Math.tan(rho), 1e-6);
  check('方解石：o 光与 e 光正交线偏振、合起来为自然光', cc.st.dop < 1e-9 && cc.hs.every((h) => Math.abs(Math.abs(h.S[1]) - h.S[0]) < 1e-12));
  // 方解石界面的严格 TM 反射：光轴垂直于入射面时，p 光的布儒斯特角 sin²θ_B = n_e²(n_o² − 1)/(n_o²n_e² − 1)
  {
    const slab = (axis, thDeg) => {
      const c = compile([E('calcite', { x: 0, w: 20, h: 400, axis })]), th = (thDeg * Math.PI) / 180;
      c.rays = [{ p: [-10 - 30 * Math.cos(th), -30 * Math.sin(th)], d: [Math.cos(th), Math.sin(th)], lam: 589.3, S: [1, -1, 0, 0] }];
      return traceScene({ ...c, opts: { partial: true, minP: 1e-9 } }).segs;
    };
    const thB = Math.asin(Math.sqrt((ne * ne * (no * no - 1)) / (no * no * ne * ne - 1))) * (180 / Math.PI);
    const rB = slab(0, thB).filter((s) => s.depth === 1 && s.b[0] < s.a[0]).reduce((a, s) => a + s.P, 0);
    check('方解石（光轴垂直表面）p 光布儒斯特角反射为零', rB < 1e-12, `θB = ${thB.toFixed(3)}°，R = ${rB}`);
    // 互易性：平行平板中 e 光在后表面的反射率等于前表面的入射反射率（光轴 30°，入射 50°）
    const sg = slab(30, 50), R1 = sg.filter((s) => s.depth === 1 && s.b[0] < s.a[0]).reduce((a, s) => a + s.P, 0);
    const eIn = sg.find((s) => s.depth === 1 && s.mode === 'e'), eBack = sg.find((s) => s.depth === 2 && s.mode === 'e');
    near('方解石 e 光：后表面反射率 = 前表面反射率（互易）', eBack.P / eIn.P, R1, 1e-9);
    check('方解石 e 光：进入晶体的功率 = 1 − R', Math.abs(eIn.P - (1 - R1)) < 1e-12);
  }
  const iso = run('isolator');
  near('光隔离器：返回光全部被偏振分束镜反射', iso.S[0], 1, 1e-12);
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

// ---------- 5. 部分相干 ----------
{
  // 余弦条纹 1 + cos(2πx/P) 与宽 w 的线光源像卷积后，可见度 = |sinc(πw/P)|（范西特–泽尼克定理的一维情形）
  const N = 512, P = 32;
  for (const w of [8, 16, 24, 40]) {
    const I = new Float64Array(N * N);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) I[i * N + j] = 1 + Math.cos((2 * Math.PI * j) / P);
    const B = W.blurLine(I, N, w), row = B.subarray(256 * N + 128, 256 * N + 384);
    const mx = Math.max(...row), mn = Math.min(...row), x = (Math.PI * w) / P;
    near(`线光源宽 ${w / P} 个条纹间距：可见度 |sinc|`, (mx - mn) / (mx + mn), Math.abs(Math.sin(x) / x), 0.01);
  }
  const sp = W.spectrumSamples(589.3, 10, 7);
  near('高斯谱线：权重和为 1', sp.reduce((a, o) => a + o.w, 0), 1, 1e-12);
  near('高斯谱线：平均波长居中', sp.reduce((a, o) => a + o.w * o.nm, 0), 589.3, 1e-9);
}

// ---------- 5b. 快速透过率函数与 mask() 逐点相同 ----------
{
  const N = 128, L = 3, same = (A, B) => { let e = 0; for (let k = 0; k < A.re.length; k++) e = Math.max(e, Math.abs(A.re[k] - B.re[k])); return e; };
  const slit = (x) => (Math.abs(Math.abs(x) - 0.4) <= 0.1 ? 1 : 0);
  check('maskX 与 mask 相同（双缝）', same(W.maskX(W.begin(N, L, 5e-4), slit), W.mask(W.begin(N, L, 5e-4), (x) => slit(x))) < 1e-12);
  const rx = (x) => (Math.abs(x) <= 0.37 ? 1 : 0), ry = (y) => (Math.abs(y) <= 0.81 ? 1 : 0);
  check('maskSep 与 mask 相同（矩孔）', same(W.maskSep(W.begin(N, L, 5e-4), rx, ry), W.mask(W.begin(N, L, 5e-4), (x, y) => rx(x) * ry(y))) < 1e-12);
  check('maskRadial 与 mask 相同（圆孔）', same(W.maskRadial(W.begin(N, L, 5e-4), (r) => (r <= 0.93 ? 1 : 0), 0.93), W.mask(W.begin(N, L, 5e-4), (x, y) => (Math.hypot(x, y) <= 0.93 ? 1 : 0))) < 1e-12);
}

// ---------- 6. 像质分析（点列图） ----------
{
  // 抛物面镜对无穷远轴上物理想成像：几何弥散为零；同口径球面镜有球差
  const mk = (k) => ({ epd: 40, field: 1, surfaces: [{ R: -400, k, t: -300, glass: 'mirror', stop: true }] });
  const Ap = analyse(mk(-1)), As = analyse(mk(0));
  check('抛物面镜轴上点列 RMS ≈ 0', Ap.rmsAt(0, Ap.zp) < 1e-6, Ap.rmsAt(0, Ap.zp));
  check('球面镜轴上有球差弥散', As.rmsAt(0, As.zp) > 1e-3, As.rmsAt(0, As.zp));
  // 球面镜球差：边缘光线纵向像差 ≈ h²/(4R)（三级近似），最小 RMS 焦面在近轴焦点与边缘焦点之间
  const lsa = 20 ** 2 / (4 * 400), dz = Math.abs(As.zb - As.zp);
  check('球面镜最佳焦面位于近轴焦点与边缘焦点之间', dz > 0.4 * lsa && dz < 0.9 * lsa, `${dz.toFixed(4)} / ${lsa.toFixed(4)}`);
  check('最佳焦面弥散小于近轴像面', As.rmsAt(0, As.zb) < 0.5 * As.rmsAt(0, As.zp));
  near('艾里斑半径 1.22λF', As.airy, (1.22 * 587.56e-6 * 200) / 40, 1e-9);
  // 小口径单透镜：单色弥散随口径三次方增大（初级球差 ∝ h³）
  const lens = (epd) => ({ epd, field: 0, surfaces: [{ R: 100, t: 6, glass: 'N-BK7', stop: true }, { R: -100, t: 100, glass: 'air' }] });
  const mono = (A) => { let s = 0, n = 0; for (const r of A.bundles[0][1]) { const t = (A.pars[1].zImage - r.p[2]) / r.d[2], y = r.p[1] + t * r.d[1], x = r.p[0] + t * r.d[0]; s += x * x + y * y; n++; } return Math.sqrt(s / n); };
  const r1 = mono(analyse(lens(4))), r2 = mono(analyse(lens(8)));
  near('单透镜单色弥散 ∝ 口径³', r2 / r1, 8, 0.25);
}

console.log(fails ? `\n工具物理验证：${fails} 项未通过，${passes} 项通过` : `工具物理验证：全部 ${passes} 项通过`);
process.exit(fails ? 1 : 0);
