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

// ---------- 7. 交流电路（spice-ts 打靶法周期稳态）与示波器触发 ----------
{
  const { LinearNet, periodicSteady } = await import('../src/core/spice.js');
  const { ScopeEngine, defaultSettings } = await import('../src/core/scopeEngine.js');
  const T = 1e-3, f = 1 / T, sq = (amp, off = 0, ff = f) => ({ shape: 'square', f: ff, amp, off, rise: 1e-12 });
  const maxErr = (fn, t0, t1, n = 600) => { let m = 0; for (let i = 1; i < n; i++) { const t = t0 + ((t1 - t0) * i) / n; m = Math.max(m, fn(t)); } return m; };
  // RC 方波稳态：高电平半周期 u = 1 − (1 − V0)e^{−t/τ}，V0 = −tanh(T/4τ)
  for (const [R, C, Rs] of [[1000, 1e-7, 50], [1e4, 1e-6, 0]]) {
    const net = new LinearNet([{ type: 'V', a: 'g', b: '0', w: sq(1), r: Rs }, { type: 'R', a: 'g', b: 'x', R }, { type: 'C', a: 'x', b: '0', C }]);
    const r = await periodicSteady(net, { vc: ['x', '0'] });
    const tau = (R + Rs) * C, V0 = -Math.tanh(T / 4 / tau);
    check(`RC 方波周期稳态（τ = ${(tau / T).toFixed(2)} T）`, maxErr((t) => Math.abs(1 - (1 - V0) * Math.exp(-t / tau) - r.at('vc', t)), 0, T / 2) < 1e-4);
  }
  // 交流耦合：平均值为零，平顶下降 2·tanh(T/4τ)（τ = 0.1 s 远大于周期，直接求稳态而不必等暂态衰减）
  {
    const net = new LinearNet([{ type: 'V', a: 'g', b: '0', w: sq(1, 2), r: 50 }, { type: 'C', a: 'g', b: 'y', C: 0.1e-6 }, { type: 'R', a: 'y', b: '0', R: 1e6 }]);
    const r = await periodicSteady(net, { vy: ['y', '0'] });
    let m = 0; for (let i = 0; i < 4096; i++) m += r.at('vy', (i / 4096) * T) / 4096;
    check('交流耦合后平均值为零', Math.abs(m) < 1e-4, m);
    const t1 = T / 1000, t2 = T / 2 - T / 1000, tau = 0.1 + 50 * 0.1e-6, top = 2 / (1 + Math.exp(-T / 2 / tau));
    near('交流耦合方波的平顶下降', r.at('vy', t1) - r.at('vy', t2), top * (Math.exp(-t1 / tau) - Math.exp(-t2 / tau)), 2e-5);
  }
  // RLC 欠阻尼阶跃响应（含 50 Ω 内阻）
  {
    const T2 = 20e-3, L = 10e-3, C = 1e-7, Rt = 70;
    const net = new LinearNet([{ type: 'V', a: 'g', b: '0', w: sq(0.5, 0.5, 1 / T2), r: 50 }, { type: 'L', a: 'g', b: 'm', L }, { type: 'R', a: 'm', b: 'k', R: 20 }, { type: 'C', a: 'k', b: '0', C }]);
    const r = await periodicSteady(net, { vc: ['k', '0'] });
    const a = Rt / 2 / L, wd = Math.sqrt(1 / (L * C) - a * a);
    const eR = maxErr((t) => Math.abs(1 - Math.exp(-a * t) * (Math.cos(wd * t) + (a / wd) * Math.sin(wd * t)) - r.at('vc', t)), 0, 1e-3);
    check('RLC 欠阻尼阶跃响应', eR < 5e-4, eR);
    near('直流分量（.op）', r.dc.vc, 0.5, 1e-5);
  }
  // 两个不同频率的源：叠加；RC 低通在 ωRC = 1 处幅值 1/√2、相移 −45°
  {
    const net = new LinearNet([{ type: 'V', a: 'g', b: '0', w: { shape: 'sine', f, amp: 1 } }, { type: 'R', a: 'g', b: 'x', R: 1 / (2 * Math.PI * f * 1e-7) }, { type: 'C', a: 'x', b: '0', C: 1e-7 },
      { type: 'V', a: 'h', b: '0', w: { shape: 'sine', f: 333.3, amp: 0.5 }, r: 50 }, { type: 'R', a: 'h', b: '0', R: 1000 }]);
    const r = await periodicSteady(net, { vc: ['x', '0'], vh: ['h', '0'] });
    check('RC 低通：幅值 1/√2、相移 −45°', maxErr((t) => Math.abs(Math.SQRT1_2 * Math.sin(2 * Math.PI * f * t - Math.PI / 4) - r.at('vc', t)), 0, T) < 1e-4);
    check('第二个源按叠加原理独立计算', r.groups.length === 2 && maxErr((t) => Math.abs((0.5 * 1000) / 1050 * Math.sin(2 * Math.PI * 333.3 * t) - r.at('vh', t)), 0, 3e-3) < 1e-4);
  }
  // 导线合并、悬空节点
  {
    const net = new LinearNet([{ type: 'V', a: 'g', b: 'e', w: { shape: 'dc', off: 3 } }, { type: 'W', a: 'e', b: '0' }, { type: 'R', a: 'g', b: 'x', R: 1000 }, { type: 'W', a: 'x', b: 'y' }, { type: 'R', a: 'y', b: '0', R: 2000 }], ['e']);
    const r = await periodicSteady(net, { v: ['x', '0'], nc: ['zz', '0'] });
    near('导线并入同一节点后的分压', r.dc.v, 2, 1e-5);
    check('未接入电路的节点电位为 0', r.dc.nc === 0);
  }
  // 示波器：单一频率信号的触发点间隔等于周期，且落在触发电平上
  {
    const sig = { groups: [{ T, data: { ch1: Float64Array.from({ length: 4096 }, (_, i) => Math.sin((2 * Math.PI * i) / 4096)) } }], dc: { ch1: 0.2 } };
    sig.at = (name, t) => { const d = sig.groups[0].data[name], u = ((((t / T) % 1) + 1) % 1) * d.length, i = Math.floor(u); return d[i % d.length] * (1 - (u - i)) + d[(i + 1) % d.length] * (u - i) + 0.2; };
    const s = defaultSettings(); s.ch[0].vdiv = 7; s.trig.level = 0.7; // 0.7 V
    const e = new ScopeEngine(s); e.setSignal(sig);
    const t1 = e.nextTrigger(0.0123), t2 = e.nextTrigger(t1 + 1e-9);
    near('触发间隔 = 信号周期', t2 - t1, T, 1e-9);
    near('触发点电平', sig.at('ch1', t1), 0.7, 1e-3);
    check('上升沿触发', sig.at('ch1', t1 + 1e-5) > sig.at('ch1', t1));
    s.trig.level = 2; e._tc = null;
    check('电平超出信号范围时不触发', e.nextTrigger(0.0123) === null);
  }
}

// ---------- 8. 直流电路、圆电流磁场、磁滞模型 ----------
{
  const { solveCircuit } = await import('../src/core/circuit.js');
  const { loopH, coilsB, axisB, MU0 } = await import('../src/physics/loopfield.js');
  const { JAMaterial, SAMPLES, simulateLoop, loopParams } = await import('../src/physics/hysteresis.js');
  const { westonE } = await import('../src/experiments/potentiometer.js');
  // 改进节点法：两个电压源各自的电流（曾经错位成下一个电源的电流）
  {
    const E1 = { type: 'V', a: 'p1', b: 'g', E: 2, r: 1 }, E2 = { type: 'V', a: 'p2', b: 'g', E: 1, r: 0 };
    const s = solveCircuit([E1, E2, { type: 'R', a: 'p1', b: 'm', R: 10 }, { type: 'R', a: 'm', b: 'g', R: 10 }, { type: 'R', a: 'p2', b: 'g', R: 5 }]);
    near('MNA 节点电压', s.v('m') - s.v('g'), 2 * 10 / 21, 1e-7);
    near('MNA 电源 1 的电流', s.cur(E1), -2 / 21, 1e-7);
    near('MNA 电源 2 的电流', s.cur(E2), -0.2, 1e-7);
  }
  // 圆电流环：轴线上与教材公式一致；离轴处与毕奥–萨伐尔数值积分一致；远场趋于磁偶极子
  {
    let e = 0;
    for (const z of [0, 0.02, 0.07, 0.3]) e = Math.max(e, Math.abs(loopH(0.1, 0, z)[1] * MU0 / axisB(0.1, 1, z) - 1));
    check('电流环轴线磁场 = μ0IR²/2(R²+z²)^1.5', e < 1e-12, e);
    const bs = (R, rho, z, n = 6000) => { let Br = 0, Bz = 0; const da = 2 * Math.PI / n; for (let i = 0; i < n; i++) { const a = (i + 0.5) * da, px = R * Math.cos(a), py = R * Math.sin(a), dlx = -R * Math.sin(a) * da, dly = R * Math.cos(a) * da, rx = rho - px, ry = -py, r3 = Math.pow(rx * rx + ry * ry + z * z, 1.5); Br += (dly * z) / r3; Bz += (dlx * ry - dly * rx) / r3; } return [Br / (4 * Math.PI), Bz / (4 * Math.PI)]; };
    let eo = 0;
    for (const [rho, z] of [[0.05, 0.02], [0.12, -0.04], [0.098, 0.003], [0.3, 0.2]]) { const a = loopH(0.1, rho, z), b = bs(0.1, rho, z); eo = Math.max(eo, Math.hypot(a[0] - b[0], a[1] - b[1]) / Math.hypot(b[0], b[1])); }
    check('电流环离轴磁场 = 毕奥–萨伐尔数值积分', eo < 1e-6, eo);
    near('远场趋于磁偶极子 μ0m/2πz³', loopH(0.1, 0, 5)[1] * MU0 / (MU0 * Math.PI * 0.01 / (2 * Math.PI * 125)), 1, 1e-3);
    const R = 0.1, H = (x) => coilsB([{ R, N: 100, I: 1, z: -R / 2 }, { R, N: 100, I: 1, z: R / 2 }], 0, 0, x)[2];
    near('亥姆霍兹线圈中心 (4/5)^1.5 μ0NI/R', H(0) / (Math.pow(0.8, 1.5) * MU0 * 100 / R), 1, 1e-12);
    check('亥姆霍兹线圈中心附近 B 的变化是四阶小量', Math.abs(H(0.05 * R) / H(0) - 1) < 1e-5, H(0.05 * R) / H(0) - 1);
  }
  // 标准电池温度公式
  near('Wolff 公式：20 °C 时等于 E20', westonE(1.0186, 20), 1.0186, 1e-12);
  near('Wolff 公式：25 °C', westonE(1.0186, 25), 1.0186 - 221.8e-6, 1e-9);
  // Jiles–Atherton 磁滞回线：对称、闭合、损耗为正；缓慢减小交变场能退磁
  {
    const cir = (U) => ({ U, f: 50, R1: 2.5, N1: 50, N2: 150, l: 0.06, S: 8e-5, R2: 1e4, C: 2e-5 });
    const m = new JAMaterial(SAMPLES[1]), st = {};
    const a = simulateLoop(m, cir(2), st, { periods: 4 }), b = simulateLoop(m, cir(2), st, { periods: 1 });
    const pa = loopParams(a.H, a.B), pb = loopParams(b.H, b.B);
    check('稳态回线逐周期重复', Math.abs(pa.Hc - pb.Hc) / pa.Hc < 2e-3 && Math.abs(pa.Br - pb.Br) / pa.Br < 2e-3, `${pa.Hc} ${pb.Hc}`);
    check('回线关于原点对称', Math.abs(Math.max(...a.B) + Math.min(...a.B)) < 1e-3 * Math.max(...a.B));
    check('矫顽力、剩磁为正，且 Br < Bm', pa.Hc > 50 && pa.Br > 0.05 && pa.Br < pa.Bm, JSON.stringify(pa));
    let loss = 0; for (let i = 0; i < a.H.length; i++) { const j = (i + 1) % a.H.length; loss += 0.5 * (a.H[i] + a.H[j]) * (a.B[j] - a.B[i]); }
    check('每周期磁滞损耗 ∮H dB > 0', loss > 0, loss);
    near('积分电容电压换算的 B 与样品 B 一致（R2C ≫ T）', Math.max(...a.y) * 1e4 * 2e-5 / (150 * 8e-5) / Math.max(...a.B), 1, 0.02);
    for (let U = 3; U > 0; U -= 0.05) simulateLoop(m, cir(U), st, { periods: 2 });
    m.stepTo(0, true);
    check('退磁后剩余磁化 < 5% Ms', Math.abs(m.M) < 0.05 * m.Ms, m.M / m.Ms);
  }
}

// ---------- 单摆：椭圆积分精确周期、级数、数值积分三者一致 ----------
{
  const { periodExact, Pendulum, equivLength } = await import('../src/physics/pendulum.js');
  const D = Math.PI / 180, T0 = 2 * Math.PI;
  near('单摆小角极限 T→2π√(L/g)', periodExact(1, 1, 1e-6), T0, 1e-9);
  for (const a of [5, 20, 60]) { const th = a * D; near(`单摆 ${a}° 精确周期 ≈ 级数 1+θ²/16+11θ⁴/3072`, periodExact(1, 1, th) / T0, 1 + th * th / 16 + 11 * th ** 4 / 3072, a < 30 ? 2e-6 : 5e-4); }
  near('单摆 90° 精确周期 = 1.18034 T₀（K(1/√2)）', periodExact(1, 1, Math.PI / 2) / T0, 1.180340599, 1e-8);
  const p = new Pendulum({ Leq: 1, g: 9.8, gamma: 0 }); p.th = 30 * D; const ts = [];
  p.step(40, (t) => ts.push(t));
  near('单摆 RK4 积分周期 = 椭圆积分精确值（30°）', (ts[ts.length - 1] - ts[0]) / (ts.length - 1), periodExact(1, 9.8, 30 * D), 1e-6);
  near('单摆能量守恒（无阻尼 40 s 后振幅不变）', p.amp / D, 30, 1e-4);
  near('复摆等效摆长 L + 2r²/5L', equivLength(1, 0.01), 1.00004, 1e-12);
}

{
  const { FieldSheet, SDF, coaxV, coaxR } = await import('../src/physics/laplace.js');
  const r1 = 8, r2 = 60, V0 = 10;
  const f = new FieldSheet({ x0: -62, x1: 62, y0: -62, y1: 62, n: 121, electrodes: [{ sdf: SDF.circle(0, 0, r1), V: V0 }, { sdf: SDF.outside(0, 0, r2), V: 0 }] });
  f.solve({ tol: 1e-8 });
  let emax = 0;
  for (const r of [12, 20, 30, 45]) for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + 0.3; emax = Math.max(emax, Math.abs(f.at(r * Math.cos(a), r * Math.sin(a)) - coaxV(r, r1, r2, V0))); }
  check('导电纸同轴电极：SOR + Shortley–Weller 数值解与 ln r 解析解相差 < 0.02 V', emax < 0.02, `最大偏差 ${emax.toFixed(4)} V`);
  near('同轴等势线半径反解 coaxR(coaxV(r)) = r', coaxR(coaxV(23, r1, r2, V0), r1, r2, V0), 23, 1e-9);
  const pl = new FieldSheet({ x0: 0, x1: 10, y0: 0, y1: 10, n: 41, electrodes: [{ sdf: SDF.rect(-1, -1, 1, 11), V: 6 }, { sdf: SDF.rect(9, -1, 11, 11), V: 0 }], inside: (x, y) => x >= 0 && x <= 10 && y >= 0 && y <= 10 });
  pl.solve({ tol: 1e-10 });
  near('平行板电极（纸边绝缘）：电位沿 x 线性分布', pl.at(5, 3.7), 3, 1e-4);
}
{
  const M = await import('../src/physics/millikan.js');
  near('空气黏度（Sutherland）η(20 °C) ≈ 1.813×10⁻⁵ Pa·s', M.airEta(20) * 1e5, 1.813, 0.004);
  const env = { d: 5e-3, rho: 981, Tc: 22, p: 101300 };
  const a = 0.9e-6, q = 4 * M.E0, U = M.balanceU({ a, q, ...env });
  near('密立根：平衡电压下收尾速度为零', M.dropV({ a, q, U, ...env }), 0, 1e-12);
  const v = M.dropV({ a, q, U: 0, ...env }), tg = 2e-3 / v, qs = M.chargeStatic({ U, tg, l: 2e-3, ...env });
  check('密立根：教科书公式算出的 q 与真值相差在 0.2%–2% 之间（略去浮力与黏度修正的系统误差）', qs / q > 1.002 && qs / q < 1.02, `q/q真 = ${(qs / q).toFixed(4)}`);
  check('密立根：典型油滴平衡电压 100–400 V、下落 2 mm 用时 8–40 s', U > 100 && U < 400 && tg > 8 && tg < 40, `U = ${U.toFixed(0)} V, t = ${tg.toFixed(1)} s`);
  near('密立根：布朗运动 1 s 内的方均根位移 √(2D·1 s) ≈ 5 μm（0.9 μm 油滴，D = kT/6πη′a）', Math.sqrt(2 * M.diffusion({ a, Tc: 22, p: 101300 })) * 1e6, 5.2, 0.4);
}

{
  const { StringModel } = await import('../src/physics/string.js');
  const s = new StringModel({ d: 0.3e-3, T: 9.794, L: 0.5, E: 1e-30 });
  near('弦振动：无刚度时 f_n = n/(2L)·√(T/μ)', s.freq(3), (3 / (2 * 0.5)) * Math.sqrt(9.794 / s.mu), 1e-9);
  near('弦振动：共振弦长 L_n = nλ/2', s.resonantL(4, 400), (4 / 2) * (Math.sqrt(9.794 / s.mu) / 400), 1e-12);
  const k = new StringModel({ d: 0.3e-3, T: 4.9, L: 0.5 }), kk = (2 * Math.PI * 400) / k.v0;
  near('钢丝抗弯刚度：共振时 fλ/√(T/μ) ≈ √(1 + EI k²/T)', (400 * 2 * k.resonantL(1, 400)) / k.v0, Math.sqrt(1 + (k.EI * kk * kk) / 4.9), 2e-4);
  k.L = k.resonantL(3, 400); const xs = Array.from({ length: 101 }, (_, i) => (k.L * i) / 100);
  const a = k.amps(400, xs), node = a[Math.round(100 / 3)], anti = a[Math.round(100 / 6)];
  check('弦振动：共振时波节处振幅 < 波腹处的 5%', node < 0.05 * anti, `波节/波腹 = ${(node / anti).toFixed(4)}`);
  k.L *= 1.004; const b = Math.max(...k.amps(400, xs.map((x) => x * 1.004)));
  near('弦振动：弦长偏离 ζ（0.4%）时振幅降到约 1/√2', b / Math.max(...a), Math.SQRT1_2, 0.03);
}
{
  const { GasVessel, gammaOf } = await import('../src/physics/gasvessel.js');
  const run = (top, adiabatic = false) => { const g = new GasVessel({ V: 0.01, Tw: 293.15, p0: 101300, tauH: 40 }); g.inflow = 0.021; g.step(1.2); g.inflow = 0; g.step(400); const p1 = g.p; if (adiabatic) g.tauH = 1e9; g.valve = true; g.step(top); g.valve = false; g.tauH = 40; g.step(500); return gammaOf(g.p0, p1, g.p); };
  near('比热容比：瓶壁不传热（τ 很大）且放完气时关阀，γ 测得值 = 1.402', run(0.8, true), 1.402, 0.002);
  near('比热容比：正常传热、放气声结束时关阀，γ 略小于真值（0.2%–0.6%）', run(0.5), 1.396, 0.003);
  check('比热容比：关阀太早（0.2 s）γ 明显偏大，关阀太晚（3 s）γ 偏小', run(0.2) > 1.6 && run(3) < 1.385, `${run(0.2).toFixed(3)} / ${run(3).toFixed(3)}`);
  const g = new GasVessel({ V: 0.01, Tw: 293.15, p0: 101300, tauH: 40 }); g.T += 1; g.step(40);
  near('比热容比：瓶壁传热使温差按 e^(-t/τ) 衰减', g.T - 293.15, Math.exp(-1), 0.01);
}
{
  const { traceOrbit, momentum, helmholtzB0, QE, ME, C0, EM } = await import('../src/physics/electronorbit.js');
  const B = 1e-3, U = 200, o = traceOrbit({ U, coils: [], BE: [0, 0, B], start: [0, 0, 0], dir: [0, 1, 0], n: 720 });
  near('电子轨道：均匀场中打到 D = 2p/(eB)（Boris 积分，含相对论）', -o.hitX, (2 * momentum(U)) / (QE * B), 2e-6);
  near('电子轨道：非相对论近似 r = √(2mU/e)/B 与相对论值相差 eU/(4mc²)', momentum(U) / (QE * B) / (Math.sqrt((2 * U) / EM) / B) - 1, (QE * U) / (4 * ME * C0 * C0), 2e-6);
  const p = o.pts, last = p[p.length - 1], r0 = momentum(U) / (QE * B);
  near('电子轨道：Boris 推进一圈后仍在同一个圆上（能量守恒）', Math.hypot(last[0] + r0, last[1]), r0, 1e-6);
  near('亥姆霍兹线圈中心 B₀ = (4/5)^{3/2} μ₀NI/R（与电流环精确解比较）', helmholtzB0(130, 1, 0.15), (await import('../src/physics/loopfield.js')).coilsB([{ R: 0.15, N: 130, I: 1, z: -0.075 }, { R: 0.15, N: 130, I: 1, z: 0.075 }], 0, 0, 0)[2], 1e-12);
}
{
  const { waterSigma, waterRho, capLength, meniscusAngle, filmForce } = await import('../src/physics/surface.js');
  near('表面张力：IAPWS 式 σ(20 °C) = 72.74 mN/m', waterSigma(20) * 1000, 72.74, 0.01);
  near('表面张力：IAPWS 式 σ(100 °C) = 58.91 mN/m', waterSigma(100) * 1000, 58.91, 0.01);
  near('表面张力：水的密度 ρ(4 °C) = 1000.0 kg/m³（最大）', waterRho(3.98), 1000, 0.01);
  const lc = capLength(waterSigma(20), waterRho(20)), D = { D1: 33.1e-3, D2: 34.96e-3, sigma: waterSigma(20), lc };
  near('表面张力：毛细长度 ℓc = √(σ/ρg) ≈ 2.73 mm', lc * 1000, 2.728, 0.002);
  const hs = Array.from({ length: 600 }, (_, i) => i * 1e-5), Fs = hs.map((h) => filmForce(h, D)), im = Fs.indexOf(Math.max(...Fs));
  near('表面张力：拉力最大处 h = √2·ℓc（弯月面竖直）', hs[im] / lc, Math.SQRT2, 0.005);
  near('表面张力：最大拉力 = πσ(D₁ + D₂)', Math.max(...Fs), Math.PI * (D.D1 + D.D2) * D.sigma, 1e-7);
  // 直接积分二维拉普拉斯—杨方程 dψ/ds = y/ℓc²，dy/ds = sinψ（从远处指数衰减的液面出发），检验 h = 2ℓc·sin(ψ/2)
  let y = 1e-6 * lc, ps = y / lc; const ds = lc / 4000, f = (y, ps) => [Math.sin(ps), y / (lc * lc)];
  while (ps < 1.1) { const k1 = f(y, ps), k2 = f(y + (ds / 2) * k1[0], ps + (ds / 2) * k1[1]), k3 = f(y + (ds / 2) * k2[0], ps + (ds / 2) * k2[1]), k4 = f(y + ds * k3[0], ps + ds * k3[1]); y += (ds / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]); ps += (ds / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]); }
  near('表面张力：积分拉普拉斯—杨方程得到的弯月面角与 h = 2ℓc·sin(ψ/2) 一致', meniscusAngle(y, lc), ps, 2e-3);
}
{
  const { AirTrack, Glider, collide, G } = await import('../src/physics/airtrack.js');
  const one = (v, x0, opt = {}) => { const t = new AirTrack({ b: 0, ...opt }); const g = new Glider({ x: x0 }); g.v = v; t.gliders.push(g); return [t, g]; };
  { const [t, g] = one(0.4123, 0.2); t.step(2); near('气垫导轨：光电门测得 Δt = Δx/v（挡光时刻插值，与步长无关）', t.gates[0].log[0].dt, g.dx / 0.4123, 1e-12); }
  { const [t, g] = one(-0.3, 1.3); t.step(3); check('气垫导轨：向左运动也按两齿前沿间距计时', Math.abs(t.gates[1].log[0].dt - g.dx / 0.3) < 1e-12 && t.gates[1].log[0].dir === -1); }
  { const t = new AirTrack({ b: 0 }); t.e = 0.97; const a = new Glider({ m: 0.28, x: 0.2 }), b = new Glider({ m: 0.18, x: 0.75 }); a.v = 0.4; t.gliders.push(a, b); t.step(0.9); const [v1, v2] = collide(0.28, 0.4, 0.18, 0, 0.97);
    near('气垫导轨：碰撞前后动量严格守恒', a.m * a.v + b.m * b.v, 0.28 * 0.4, 1e-14); near('气垫导轨：碰后速度符合恢复系数 e', (b.v - a.v) / 0.4, 0.97, 1e-12); near('气垫导轨：与一维碰撞公式一致', a.v, v1, 1e-12); }
  { const t = new AirTrack({ b: 2.5e-3 }); t.e = 0; const a = new Glider({ m: 0.28, x: 0.2 }), b = new Glider({ m: 0.18, x: 0.75 }); a.v = 0.4; t.gliders.push(a, b); t.step(2);
    check('气垫导轨：尼龙搭扣碰后两滑块粘在一起（阻力不同也不分开）', Math.abs(a.v - b.v) < 1e-12 && Math.abs(b.x - a.x - 0.2) < 1e-9, `${a.v} ${b.v} ${b.x - a.x}`); check('气垫导轨：完全非弹性碰撞记入碰撞事件', t.cols.length === 1); }
  { const t = new AirTrack({ b: 2.5e-3, gates: [] }); const g = new Glider({ m: 0.18, x: 0.2 }); g.v = 0.3; t.gliders.push(g); t.step(2); near('气垫导轨：黏性阻力 v = v₀e^(−bt/m)', g.v, 0.3 * Math.exp((-2.5e-3 / 0.18) * 2), 1e-12); }
  { const [t, g] = one(0, 1, { theta: 1e-3, gates: [] }); t.step(2); near('气垫导轨：倾斜 θ 时 x = −½g·sinθ·t²', g.x - 1, -0.5 * G * Math.sin(1e-3) * 4, 1e-12); }
}
{
  const { makeJunction, makeNTC, KB, QE, T25 } = await import('../src/physics/semi.js');
  const j = makeJunction({ n: 1, Ir300: 0 });
  near('PN 结：恒流压降满足 I(U_F) = I_F（牛顿迭代）', j.current(j.voltage(1e-4, 330), 330) / 1e-4, 1, 1e-6);
  const sl = (Math.log(j.current(0.52, 300)) - Math.log(j.current(0.50, 300))) / 0.02;
  near('PN 结：理想结 ln I–U 斜率 = e/kT', sl / (QE / (KB * 300)), 1, 1e-4);
  const S = (j.voltage(1e-4, 340) - j.voltage(1e-4, 300)) / 40;
  check('PN 结：恒流 100 μA 时温度灵敏度约 −2 mV/K', S < -1.6e-3 && S > -2.6e-3, `${S}`);
  const n = makeNTC({ R25: 1e4, B: 3400, g: 0 });
  near('热敏电阻：25 °C 时 R = R₂₅', n.R(T25) / 1e4, 1, 1e-9);
  near('热敏电阻：R_T = R₂₅·exp[B(1/T − 1/T₂₅)]', n.R(T25 + 10) / (1e4 * Math.exp(3400 * (1 / (T25 + 10) - 1 / T25))), 1, 1e-9);
}
{
  const { HG546, ringTheta, lorentz, EM_TRUE, C_LIGHT, LAM0 } = await import('../src/physics/zeeman.js');
  check('塞曼效应：汞 546.1 nm 分裂为 3 条 π + 6 条 σ', HG546.filter((c) => c.pol === 'pi').length === 3 && HG546.filter((c) => c.pol === 'sigma').length === 6);
  check('塞曼效应：分量位置 0、±1/2（π）与 ±1、±3/2、±2（σ）', HG546.map((c) => c.s).sort((a, b) => a - b).join(',') === '-2,-1.5,-1,-0.5,0,0.5,1,1.5,2', HG546.map((c) => c.s).join(','));
  const sum = (p) => HG546.filter((c) => c.pol === p).reduce((a, c) => a + c.w, 0);
  near('塞曼效应：π 与 σ 总强度相等（各向同性光源极化求和）', sum('pi') / sum('sigma'), 1, 0.01);
  const s0 = 1 / LAM0, K = Math.floor(4e-3 * s0), d = (K + 0.5) / (2 * s0), B = 1, f = 0.12, L = lorentz(B);
  const D2 = (k, s) => (2 * f * Math.tan(ringTheta(k, s0 + s * L, d))) ** 2;
  const em = ((2 * Math.PI * C_LIGHT) / (d * B)) * (D2(K, 0.5) - D2(K, -0.5)) / (D2(K - 1, 0) - D2(K, 0));
  near('塞曼效应：由圆环直径公式反求 e/m', em / EM_TRUE, 1, 3e-3);
}
console.log(fails ? `\n工具物理验证：${fails} 项未通过，${passes} 项通过` : `工具物理验证：全部 ${passes} 项通过`);
process.exit(fails ? 1 : 0);
