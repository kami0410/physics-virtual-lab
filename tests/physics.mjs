// 物理模型数值验证（不需要浏览器）：node tests/physics.mjs
// 思路：仿真里用的是闭式公式（为了实时计算）；这里用更原始的模型（精确光程、逐点非相干叠加、数值积分）
// 独立算一遍，检查两者一致。公式写错、近似条件用错，这里都会报出来。
import { cmf, spectralRenderer, wavelengthToRGB } from '../src/physics/color.js';
import { GLASSES, sellmeier, abbeNumber } from '../src/physics/glass.js';
import { WHITE, newtonIntensity } from '../src/physics/interference.js';
import { besselJ } from '../src/physics/bessel.js';
import { fresnelR, polarizerM, applyM, sourceStokes } from '../src/physics/polarization.js';

let fails = 0, passes = 0;
function check(name, ok, detail = '') {
  if (ok) passes++; else { fails++; console.log(`✗ ${name}  ${detail}`); }
}
const near = (name, got, want, tol) => check(name, Math.abs(got - want) <= tol, `得到 ${got}，应为 ${want}（允差 ${tol}）`);
const sinc = (u) => (Math.abs(u) < 1e-12 ? 1 : Math.sin(u) / u);
const mean = (f, a, b, n = 2001) => { let s = 0; for (let i = 0; i < n; i++) s += f(a + ((b - a) * i) / (n - 1)) * (i === 0 || i === n - 1 ? 0.5 : 1); return s / (n - 1); };

// ---------- 1. 色匹配函数：与 CIE 1931 2° 表值比较（解析拟合误差约为峰值的 1%） ----------
const CIE = [[450, 0.3362, 0.038, 1.7721], [500, 0.0049, 0.323, 0.272], [555, 0.5121, 1.0, 0.0057], [600, 1.0622, 0.631, 0.0008], [650, 0.2835, 0.107, 0]];
for (const [nm, x, y, z] of CIE) {
  const c = cmf(nm);
  near(`CIE x̄(${nm})`, c[0], x, 0.04); near(`CIE ȳ(${nm})`, c[1], y, 0.04); near(`CIE z̄(${nm})`, c[2], z, 0.04);
}
{
  const R = spectralRenderer();
  const w = R.toRGB(() => 1);
  check('白光全部透过显示为白色', w.every((v) => Math.abs(v - 1) < 1e-6), w.join(','));
  const dom = (nm) => { const c = wavelengthToRGB(nm); return c.indexOf(Math.max(...c)); };
  check('632.8 nm 为红色', dom(632.8) === 0); check('546.1 nm 为绿色', dom(546.1) === 1); check('450 nm 为蓝色', dom(450) === 2);
}

// ---------- 2. Sellmeier 系数：与玻璃目录的 n_d、ν_d 比较 ----------
for (const [k, g] of Object.entries(GLASSES)) {
  near(`${k} n_d`, sellmeier(k, 587.56), g.nd, 2e-5);
  near(`${k} ν_d`, abbeNumber(k), g.vd, 0.02);
  check(`${k} 正常色散`, sellmeier(k, 404.66) > sellmeier(k, 546.07) && sellmeier(k, 546.07) > sellmeier(k, 656.27));
}

// ---------- 3. 杨氏双缝：光源缝宽的空间相干性 V = sin u / u，u = πwd/(λR) ----------
// 精确模型：缝光源上每一点到两缝、两缝到观察点都用勾股定理算光程，再对缝宽逐点非相干叠加
{
  const lam = 589.3e-6, d = 0.6, R = 300, D = 800;
  const dl = (ys, X) => (Math.hypot(d / 2 - ys, R) + Math.hypot(X - d / 2, D)) - (Math.hypot(-d / 2 - ys, R) + Math.hypot(X + d / 2, D));
  const k = (2 * Math.PI) / lam;
  for (const u0 of [0.5, 2, Math.PI, 4.2, 7]) {
    const w = (u0 * lam * R) / (Math.PI * d);
    const Vnum = mean((ys) => Math.cos(k * dl(ys, 0)), -w / 2, w / 2);
    near(`杨氏 相干度 u=${u0.toFixed(2)}`, Vnum, sinc(u0), 2e-3);
  }
  // 条纹间距 λD/d
  const slope = (dl(0, 0.01) - dl(0, -0.01)) / 0.02;
  near('杨氏 条纹间距 λD/d', lam / Math.abs(slope), (lam * D) / d, 1e-3 * ((lam * D) / d));
}

// ---------- 4. 菲涅耳双棱镜：V = sin u / u，u = πw·d′/(λa)，d′ = d(D−a)/D ----------
// 精确模型：棱镜当作相位屏（附加光程 −δ|h|，δ 为偏向角），按费马原理在上、下两半各求一条
// 光程取极值的光线，两条光线的光程差逐点算出，再对缝宽非相干叠加。
{
  const lam = 589.3e-6, a = 250, D = 900, delta = 0.002, d = 2 * a * delta, k = (2 * Math.PI) / lam;
  const path = (h, ys, X) => Math.hypot(h - ys, a) + Math.hypot(X - h, D - a) - delta * Math.abs(h);
  const ray = (ys, X, sgn) => {
    // 在 h·sgn > 0 一侧解 dL/dh = 0（牛顿迭代）
    let h = sgn * 1;
    for (let i = 0; i < 60; i++) {
      const r1 = Math.hypot(h - ys, a), r2 = Math.hypot(X - h, D - a);
      const f = (h - ys) / r1 - (X - h) / r2 - delta * sgn;
      const fp = a * a / r1 ** 3 + (D - a) ** 2 / r2 ** 3;
      h -= f / fp;
    }
    return path(h, ys, X);
  };
  const dl = (ys, X) => ray(ys, X, 1) - ray(ys, X, -1);
  const dp = (d * (D - a)) / D;
  for (const u0 of [0.6, 2, Math.PI, 4.5]) {
    const w = (u0 * lam * a) / (Math.PI * dp);
    const Vnum = mean((ys) => Math.cos(k * dl(ys, 0)), -w / 2, w / 2, 801);
    near(`双棱镜 相干度 u=${u0.toFixed(2)}`, Vnum, sinc(u0), 3e-3);
  }
  const slope = (dl(0, 0.02) - dl(0, -0.02)) / 0.04;
  near('双棱镜 条纹间距 λD/d', lam / Math.abs(slope), (lam * D) / d, 2e-3 * ((lam * D) / d));
}

// ---------- 5. 白光干涉：零光程处可见度最高，几微米外条纹消失 ----------
{
  const G = (D) => { let s = 0; for (let j = 0; j < WHITE.n; j++) s += WHITE.wg[j] * Math.cos(WHITE.k[j] * D); return s; };
  near('白光 零光程 可见度', G(0), 1, 1e-6);
  // 光程差很小时与平均波长的单色光几乎一样：G(Δ) ≈ cos(2πΔ/λ̄)
  near('白光 50 nm 处 ≈ cos(2πΔ/λ̄)', G(0.00005), Math.cos((2 * Math.PI * 0.00005) / 0.00056), 0.03);
  // 第一暗纹在半个平均波长附近（≈0.27 µm）
  let Dmin = 0, gmin = 1;
  for (let D = 0; D < 0.0006; D += 0.000002) if (G(D) < gmin) { gmin = G(D); Dmin = D; }
  check('白光 第一暗纹位置 0.24–0.32 µm', Dmin > 0.00024 && Dmin < 0.00032, `${(Dmin * 1e6).toFixed(3)} µm`);
  let far = 0; for (let D = 0.008; D < 0.015; D += 0.00001) far = Math.max(far, Math.abs(G(D)));
  check('白光 8–15 µm 外条纹消失（可见度 < 0.05）', far < 0.05, far);
}

// ---------- 6. 牛顿环：钠双线 1:0.5 非相干叠加的可见度拍 ----------
{
  const lines = [[589.0e-6, 1], [589.6e-6, 0.5]];
  const a1 = 0.2, a2 = 0.2 * 0.96, V1 = (2 * a1 * a2) / (a1 * a1 + a2 * a2);
  const dsig = 1 / 589.0e-6 - 1 / 589.6e-6;
  for (const e of [0.01, 0.1, 0.2, 0.289, 0.4]) {
    // 在厚度 e 附近扫过一个多条纹，求 (Imax−Imin)/(Imax+Imin)
    let mx = -1, mn = 2;
    for (let t = 0; t < 2000; t++) { const ee = e + (t / 2000) * 6e-4; const I = newtonIntensity(2 * ee, 1, 0, lines); mx = Math.max(mx, I); mn = Math.min(mn, I); }
    const Vnum = (mx - mn) / (mx + mn);
    const Vth = (V1 * Math.hypot(1 + 0.5 * Math.cos(2 * Math.PI * 2 * e * dsig), 0.5 * Math.sin(2 * Math.PI * 2 * e * dsig))) / 1.5;
    near(`牛顿环 钠双线可见度 e=${e} mm`, Vnum, Vth, 0.01);
  }
}

// ---------- 7. 贝塞尔函数（超声光栅衍射级强度 J_n²） ----------
near('J0(1)', besselJ(0, 1), 0.7651976866, 1e-9);
near('J1(1)', besselJ(1, 1), 0.4400505857, 1e-9);
near('J2(3)', besselJ(2, 3), 0.4860912606, 1e-9);
near('J0 第一零点 2.404825558', besselJ(0, 2.404825558), 0, 1e-8);
near('J−1 = −J1', besselJ(-1, 2.2), -besselJ(1, 2.2), 1e-14);
{ let s = 0; for (let n = -20; n <= 20; n++) s += besselJ(n, 3.3) ** 2; near('Σ J_n² = 1（能量守恒）', s, 1, 1e-10); }

// ---------- 8. 菲涅耳公式与马吕斯定律 ----------
{
  const n = 1.5163, thB = Math.atan(n);
  near('布儒斯特角处 R_p = 0', fresnelR(thB, n).p, 0, 1e-12);
  near('正入射 R = ((n−1)/(n+1))²', fresnelR(1e-9, n).s, ((n - 1) / (n + 1)) ** 2, 1e-9);
  check('R_s ≥ R_p', [10, 30, 50, 70, 85].every((t) => fresnelR((t * Math.PI) / 180, n).s >= fresnelR((t * Math.PI) / 180, n).p));
  // 斜入射 R_s 与 n 无关的另一表达：R_s = ((cosθ − n cosθt)/(cosθ + n cosθt))²
  const th = 0.9, tt = Math.asin(Math.sin(th) / n);
  near('R_s 两种表达一致', fresnelR(th, n).s, ((Math.cos(th) - n * Math.cos(tt)) / (Math.cos(th) + n * Math.cos(tt))) ** 2, 1e-12);
  for (const t of [0, 30, 60, 90]) {
    const S = applyM(polarizerM((t * Math.PI) / 180, 1, 0), applyM(polarizerM(0, 1, 0), sourceStokes(1, 0, 0)));
    near(`马吕斯定律 θ=${t}°`, S[0], 0.5 * Math.cos((t * Math.PI) / 180) ** 2, 1e-12);
  }
}

console.log(fails ? `\n物理验证：${fails} 项未通过，${passes} 项通过` : `物理验证：全部 ${passes} 项通过`);
process.exit(fails ? 1 : 0);
