// 单摆的精确动力学：不作小角近似，摆球按刚体（复摆）处理，含空气阻尼。
//   运动方程  θ̈ = −(g/L_eq)·sinθ − γθ̇，  L_eq = L + 2r²/(5L)（L 为悬点到球心的距离，r 为球半径）
//   有限振幅的精确周期  T = 2π√(L_eq/g) / AGM(1, cos(θ₀/2))（第一类完全椭圆积分的算术–几何平均算法）
//   级数近似  T ≈ T₀(1 + θ₀²/16 + 11θ₀⁴/3072)

/** 算术–几何平均 */
export function agm(a, b) {
  for (let i = 0; i < 40 && Math.abs(a - b) > 1e-15 * a; i++) { const an = (a + b) / 2; b = Math.sqrt(a * b); a = an; }
  return (a + b) / 2;
}
/** 振幅 th0（rad）时的精确周期 */
export const periodExact = (Leq, g, th0) => (2 * Math.PI * Math.sqrt(Leq / g)) / agm(1, Math.cos(th0 / 2));
/** 摆球的等效摆长（复摆修正） */
export const equivLength = (L, r) => L + (2 * r * r) / (5 * L);

export class Pendulum {
  constructor({ Leq, g, gamma = 0 }) {
    this.Leq = Leq; this.g = g; this.gamma = gamma;
    this.th = 0; this.w = 0; this.t = 0;
  }
  acc(th, w) { return -(this.g / this.Leq) * Math.sin(th) - this.gamma * w; }
  /** 积分 dt 秒；每次摆球向正方向经过最低点时调用 onCross(精确时刻)，每个周期一次 */
  step(dt, onCross) {
    const T0 = 2 * Math.PI * Math.sqrt(this.Leq / this.g);
    const n = Math.max(1, Math.ceil(dt / (T0 / 400))), h = dt / n;
    for (let i = 0; i < n; i++) {
      const th0 = this.th, w0 = this.w;
      const k1t = w0, k1w = this.acc(th0, w0);
      const k2t = w0 + (h / 2) * k1w, k2w = this.acc(th0 + (h / 2) * k1t, w0 + (h / 2) * k1w);
      const k3t = w0 + (h / 2) * k2w, k3w = this.acc(th0 + (h / 2) * k2t, w0 + (h / 2) * k2w);
      const k4t = w0 + h * k3w, k4w = this.acc(th0 + h * k3t, w0 + h * k3w);
      this.th = th0 + (h / 6) * (k1t + 2 * k2t + 2 * k3t + k4t);
      this.w = w0 + (h / 6) * (k1w + 2 * k2w + 2 * k3w + k4w);
      if (th0 < 0 && this.th >= 0 && onCross) onCross(this.t + (h * -th0) / (this.th - th0));
      this.t += h;
    }
  }
  /** 当前振幅（由能量换算，rad） */
  get amp() {
    const E = 0.5 * (this.Leq / this.g) * this.w * this.w + (1 - Math.cos(this.th));
    return Math.acos(Math.max(-1, Math.min(1, 1 - E)));
  }
}
