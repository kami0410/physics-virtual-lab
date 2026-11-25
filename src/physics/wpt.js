// 磁耦合谐振式无线输电
// 线圈：平面螺旋线圈近似为 N 个同心圆环，半径从 r0 起每圈增加 p，导线半径 rw。
//   两圆环（半径 a、b，轴向间距 d）的互感用麦克斯韦（诺依曼积分）公式：
//     M = μ₀√(ab)[(2/m − m)K(m) − (2/m)E(m)]，m² = 4ab/((a+b)² + d²)，K、E 为第一、二类完全椭圆积分（AGM 算法）。
//   单圈自感 μ₀r(ln(8r/r_w) − 2)（高频，忽略导线内自感），线圈自感 = 各圈自感 + 圈间互感之和。
// 电路：两个串联 RLC 谐振回路经互感 M 耦合，正弦稳态用相量法求解：
//   Z₁ = R_s + R₁ + jωL₁ + 1/(jωC₁)，Z₂ = R₂ + R_L + jωL₂ + 1/(jωC₂)
//   I₁ = V_s/(Z₁ + ω²M²/Z₂)，I₂ = −jωM·I₁/Z₂
//   线圈交流电阻计入趋肤效应 R ∝ √f。
const MU0 = 4e-7 * Math.PI;

/** 完全椭圆积分 K(m)、E(m)，m 为模数（不是参数 m²） */
export function ellipKE(m) {
  let a = 1, b = Math.sqrt(1 - m * m), c = m, s = 0.5 * c * c, p = 1;
  for (let i = 0; i < 40 && Math.abs(c) > 1e-16; i++) { const an = (a + b) / 2; c = (a - b) / 2; b = Math.sqrt(a * b); a = an; p *= 2; s += 0.5 * p * c * c; }
  const K = Math.PI / (2 * a);
  return { K, E: K * (1 - s) };
}

/** 两个同轴圆环的互感（H） */
export function loopM(a, b, d) {
  const m = Math.sqrt((4 * a * b) / ((a + b) ** 2 + d * d)), { K, E } = ellipKE(m);
  return MU0 * Math.sqrt(a * b) * ((2 / m - m) * K - (2 / m) * E);
}

export const radii = (c) => Array.from({ length: c.N }, (_, i) => c.r0 + i * c.p);
/** 平面螺旋线圈的自感（H） */
export function coilL(c) {
  const r = radii(c); let L = 0;
  for (let i = 0; i < r.length; i++) for (let j = 0; j < r.length; j++) L += i === j ? MU0 * r[i] * (Math.log((8 * r[i]) / c.rw) - 2) : loopM(r[i], r[j], 0);
  return L;
}
/** 两个相同线圈正对、间距 d 时的互感（H） */
export function coilM(c, d) {
  const r = radii(c); let M = 0;
  for (const a of r) for (const b of r) M += loopM(a, b, d);
  return M;
}

/** 复数小工具 */
const cx = (re, im = 0) => ({ re, im });
const add = (a, b) => cx(a.re + b.re, a.im + b.im);
const mul = (a, b) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const div = (a, b) => { const q = b.re * b.re + b.im * b.im; return cx((a.re * b.re + a.im * b.im) / q, (a.im * b.re - a.re * b.im) / q); };
const abs = (a) => Math.hypot(a.re, a.im);

/**
 * 正弦稳态。o = {Vs（峰值）, Rs, R1, R2（在 f0r 处的交流电阻）, f0r, L1, L2, C1, C2, RL, M, open}
 * open：接收回路开路（拆下 C₂ 与 R_L），返回感应电动势。
 * 返回峰值：I1、I2（A），U1（发射线圈+C₁ 两端电压），U2（负载电压或开路感应电压），P1（送入发射回路的功率），P2（负载功率），eta
 */
export function wptSolve(f, o) {
  const w = 2 * Math.PI * f, sk = Math.sqrt(f / o.f0r), R1 = o.R1 * sk, R2 = o.R2 * sk;
  const X = (L, C) => w * L - 1 / (w * C);
  const Z1c = cx(R1, X(o.L1, o.C1));
  const Z1 = add(cx(o.Rs), Z1c);
  if (o.open) {
    const I1 = div(cx(o.Vs), Z1), U1 = mul(I1, Z1c);
    return { I1: abs(I1), I2: 0, U1: abs(U1), U2: w * o.M * abs(I1), P1: 0.5 * abs(I1) ** 2 * R1, P2: 0, eta: 0 };
  }
  const Z2 = cx(R2 + o.RL, X(o.L2, o.C2)), refl = div(cx(w * w * o.M * o.M), Z2);
  const I1 = div(cx(o.Vs), add(Z1, refl)), I2 = mul(div(cx(0, -w * o.M), Z2), I1);
  const i1 = abs(I1), i2 = abs(I2), U1 = abs(mul(I1, add(Z1c, refl)));
  const P2 = 0.5 * i2 * i2 * o.RL, P1 = 0.5 * (i1 * i1 * R1 + i2 * i2 * (R2 + o.RL));
  return { I1: i1, I2: i2, U1, U2: i2 * o.RL, P1, P2, eta: P2 / P1 };
}

/** 扫频曲线上的峰（局部极大），返回频率数组 */
export function peaks(fn, f1, f2, n = 600) {
  const ys = [], out = [];
  for (let i = 0; i <= n; i++) ys.push(fn(f1 + ((f2 - f1) * i) / n));
  for (let i = 1; i < n; i++) if (ys[i] > ys[i - 1] && ys[i] >= ys[i + 1]) {
    // 黄金分割细化
    let a = f1 + ((f2 - f1) * (i - 1)) / n, b = f1 + ((f2 - f1) * (i + 1)) / n;
    for (let k = 0; k < 60; k++) { const m1 = b - (b - a) * 0.618, m2 = a + (b - a) * 0.618; if (fn(m1) < fn(m2)) a = m1; else b = m2; }
    out.push((a + b) / 2);
  }
  return out;
}
