// 波尔共振仪的摆轮：J·θ'' = −k(θ)·θ − b·θ' + k·α₀·cos(ωt)
// 蜗卷弹簧的劲度系数随转角略有变化 k(θ) = k₀(1 + cθ²)，使自由振动周期随振幅有千分之几的变化（实际仪器也是这样，
// 所以教材要求先测出不同振幅下的 T₀，求相位差理论值时按振幅取对应的 ω₀）。
// 电磁阻尼力矩与角速度成正比：β = b/2J。强迫力矩来自电机偏心轮通过连杆扭动弹簧外端，幅度 k₀α₀。
// 以 β、ω₀ 为参数积分（与 J 无关）；RK4，步长 ≤ 2 ms，并检测正向峰值（振幅）、向上过零（周期）与驱动相位参考点。

const DEG = Math.PI / 180;

/** 线性受迫振动的稳态振幅（与驱动振幅 α₀ 同单位）与相位差（rad，0–π） */
export function steady(w, w0, beta, a0) {
  const A = (a0 * w0 * w0) / Math.sqrt((w0 * w0 - w * w) ** 2 + 4 * beta * beta * w * w);
  const phi = Math.atan2(2 * beta * w, w0 * w0 - w * w);
  return { A, phi };
}

export class BohrWheel {
  constructor({ w0 = 4, beta = 0.002, c = 0.0016 } = {}) {
    this.w0 = w0; this.beta = beta; this.c = c;
    this.th = 0; this.om = 0; this.t = 0;
    this.drive = false; this.w = w0; this.a0 = 3 * DEG; this.ph = 0; // 驱动角相位 ωt（mod 2π）
    this.peaks = []; // {t, A}（正向峰值，度）
    this.ups = []; // 向上过零时刻
    this.refs = []; // 驱动参考点处的 {t, th, om}
  }
  acc(th, om, ph) {
    const w0 = this.w0, k = w0 * w0 * (1 + this.c * th * th);
    return -k * th - 2 * this.beta * om + (this.drive ? w0 * w0 * this.a0 * Math.cos(ph) : 0);
  }
  step(h) {
    const { th, om, ph } = this, w = this.drive ? this.w : 0;
    const a1 = this.acc(th, om, ph);
    const t2 = th + (h / 2) * om, o2 = om + (h / 2) * a1, a2 = this.acc(t2, o2, ph + (w * h) / 2);
    const t3 = th + (h / 2) * o2, o3 = om + (h / 2) * a2, a3 = this.acc(t3, o3, ph + (w * h) / 2);
    const t4 = th + h * o3, o4 = om + h * a3, a4 = this.acc(t4, o4, ph + w * h);
    const nth = th + (h / 6) * (om + 2 * o2 + 2 * o3 + o4), nom = om + (h / 6) * (a1 + 2 * a2 + 2 * a3 + a4);
    // 事件：正向峰值（角速度由正变负）——二次插值求峰值
    if (om > 0 && nom <= 0) {
      const s = (om / (om - nom)) * h;
      this.peaks.push({ t: this.t + s, A: (th + om * s + (0.5 * (nom - om) * s * s) / h) / DEG });
      if (this.peaks.length > 60) this.peaks.shift();
    }
    if (th < 0 && nth >= 0) { this.ups.push(this.t + (-th / (nth - th)) * h); if (this.ups.length > 40) this.ups.shift(); }
    let nph = ph + w * h;
    if (this.drive && nph >= 2 * Math.PI) {
      nph -= 2 * Math.PI;
      const f = 1 - nph / (w * h);
      this.refs.push({ t: this.t + f * h, th: th + f * (nth - th), om: om + f * (nom - om) });
      if (this.refs.length > 40) this.refs.shift();
    }
    this.th = nth; this.om = nom; this.ph = nph; this.t += h;
  }
  advance(dt) {
    const n = Math.max(1, Math.ceil(dt / 0.002)), h = dt / n;
    for (let i = 0; i < n; i++) this.step(h);
  }
  /** 最近一次完整振动的振幅（度）与周期（s） */
  get lastA() { return this.peaks.length ? this.peaks[this.peaks.length - 1].A : 0; }
  lastT(n = 1) { const u = this.ups; return u.length > n ? (u[u.length - 1] - u[u.length - 1 - n]) / n : NaN; }
  /** 稳态相位差（度）：驱动参考点处 θ = A cosφ，θ' = Aω sinφ */
  get phase() {
    const r = this.refs[this.refs.length - 1];
    if (!r) return NaN;
    return (Math.atan2(r.om / this.w, r.th) / DEG + 360) % 360;
  }
}
