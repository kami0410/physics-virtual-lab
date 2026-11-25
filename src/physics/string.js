// 弦线上的驻波：两劈尖之间长 L 的钢丝，张力 T、线密度 μ，在 x0 处受频率 f 的简谐力（电磁驱动）。
//   计入钢丝的抗弯刚度（细钢丝不是理想柔软弦）：色散关系 ω² = (T/μ)k² + (EI/μ)k⁴，
//   两端劈尖近似简支，模式 φ_n = sin(nπx/L)，k_n = nπ/L。于是共振时测得的“波长”2L/n 对应的相速度
//   v = fλ = √(T/μ)·√(1 + EI k²/T)，比理想弦略大（本仿真中约 0.1%–0.5%）。
//   受迫响应按模式叠加：Y(x) = Σ φ_n(x0) φ_n(x) / (ω_n² − ω² + 2iζω_nω)（取 n = 1…NM）。

export const STEEL = { rho: 7850, E: 2.0e11 };
const NM = 40;

export class StringModel {
  /** @param {{ d:number, T:number, L:number, x0?:number, zeta?:number, rho?:number, E?:number }} o 单位 SI */
  constructor(o) { Object.assign(this, { x0: 0.02, zeta: 0.004, rho: STEEL.rho, E: STEEL.E }, o); }
  get mu() { return this.rho * Math.PI * (this.d / 2) ** 2; }
  get EI() { return (this.E * Math.PI * this.d ** 4) / 64; }
  /** 理想弦波速 √(T/μ) */
  get v0() { return Math.sqrt(this.T / this.mu); }
  /** 第 n 个模式的角频率 */
  omega(n, L = this.L) { const k = (n * Math.PI) / L; return Math.sqrt((this.T / this.mu) * k * k + (this.EI / this.mu) * k ** 4); }
  /** 第 n 个模式的频率（Hz） */
  freq(n, L = this.L) { return this.omega(n, L) / (2 * Math.PI); }
  /** 给定频率 f，第 n 个模式共振时的弦长（解 ω_n(L) = 2πf，单调） */
  resonantL(n, f) {
    const w = 2 * Math.PI * f, a = this.EI / this.mu, b = this.T / this.mu;
    const k2 = (2 * w * w) / (b + Math.sqrt(b * b + 4 * a * w * w)); // a k⁴ + b k² − ω² = 0 的正根（a → 0 时也稳定）
    return (n * Math.PI) / Math.sqrt(k2);
  }
  /** 频率 f 下沿弦的振幅分布：返回 x 处的复振幅（取模）——单位任意，与驱动力成正比 */
  amps(f, xs, L = this.L) {
    const w = 2 * Math.PI * f, out = new Float64Array(xs.length);
    const re = new Float64Array(xs.length), im = new Float64Array(xs.length);
    for (let n = 1; n <= NM; n++) {
      const wn = this.omega(n, L), dr = wn * wn - w * w, di = 2 * this.zeta * wn * w, den = dr * dr + di * di;
      const c = Math.sin((n * Math.PI * this.x0) / L), gr = (c * dr) / den, gi = (-c * di) / den;
      for (let i = 0; i < xs.length; i++) { const s = Math.sin((n * Math.PI * xs[i]) / L); re[i] += gr * s; im[i] += gi * s; }
    }
    for (let i = 0; i < xs.length; i++) out[i] = Math.hypot(re[i], im[i]);
    return out;
  }
  /** 离 L 最近的共振模式序号 */
  nearestMode(f, L = this.L) { const w = 2 * Math.PI * f; let best = 1, bd = Infinity; for (let n = 1; n <= NM; n++) { const d = Math.abs(this.omega(n, L) - w); if (d < bd) { bd = d; best = n; } } return best; }
}
