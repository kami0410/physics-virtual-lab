// G-M 计数管与放射性计数统计
// 坪曲线：外加电压低于起始电压 V_s 时没有计数；略高于 V_s 后计数率迅速上升到坪区，坪区计数率随电压缓慢增大（坪斜）；
//   电压超过 V_s + 坪长后进入连续放电，计数率陡增。
// 死时间（不可扩展型）：真实计数率 n 时观测计数率 m = n/(1 + nτ)，反过来 n = m/(1 − mτ)。
// 双源法：n₁ + n₂ = n₁₂ + n_b（真实计数率，各自含本底），对观测值解出 τ。
// 计数服从泊松分布；均值很大时用正态近似抽样。

/** 坪曲线上的相对计数效率（坪起点处为 1） */
export function plateau(V, o) {
  const { Vs, len, slope } = o; // slope：每 100 V 的相对增加
  if (V <= Vs - 5) return 0;
  const rise = 1 / (1 + Math.exp(-(V - Vs - 12) / 4));
  const tilt = 1 + slope * Math.max(0, V - Vs - 25) / 100;
  const dis = V > Vs + len ? Math.exp((V - Vs - len) / 18) : 1;
  return rise * tilt * dis;
}

export const observed = (n, tau) => n / (1 + n * tau);
export const corrected = (m, tau) => m / (1 - m * tau);

/** 双源法求死时间（精确解，二分）。m1、m2、m12、mb 为观测计数率（1/s） */
export function twoSourceTau(m1, m2, m12, mb) {
  const f = (t) => corrected(m1, t) + corrected(m2, t) - corrected(m12, t) - corrected(mb, t);
  let lo = 0, hi = 0.999 / m12;
  if (f(lo) <= 0) return 0;
  for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
/** 常用近似式 τ ≈ (m₁ + m₂ − m₁₂ − m_b)/(m₁₂² − m₁² − m₂²) */
export const twoSourceApprox = (m1, m2, m12, mb) => (m1 + m2 - m12 - mb) / (m12 * m12 - m1 * m1 - m2 * m2);

/** 泊松抽样：均值小于 50 用乘积法，否则用正态近似（连续性修正） */
export function poisson(mu, rnd = Math.random) {
  if (mu <= 0) return 0;
  if (mu < 50) { const L = Math.exp(-mu); let k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; }
  let u = 0, v = 0; while (u === 0) u = rnd(); v = rnd();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(0, Math.round(mu + Math.sqrt(mu) * z));
}

/** 泊松分布概率 P(k; μ)（对数形式避免溢出） */
export function poissonP(k, mu) {
  let lf = 0; for (let i = 2; i <= k; i++) lf += Math.log(i);
  return Math.exp(k * Math.log(mu) - mu - lf);
}
