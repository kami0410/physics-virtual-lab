// 储气瓶中的空气：绝热膨胀法测比热容比 γ（克莱门–德索尔姆法）
//   状态量：瓶内空气的物质的量 n、温度 T（均匀），容积 V 固定，p = nRT/V。
//   能量方程（开口系统）：n·Cv·dT/dt = Σ(进出气体带入的焓 − 留在瓶内的内能) + 传热
//     放气（流出）：n Cv dT/dt = R·T·ṅ + Q̇（ṅ < 0，相当于剩下的气体绝热膨胀）
//     打气（流入，温度 Tin）：n Cv dT/dt = (Cp·Tin − Cv·T)·ṅ + Q̇
//     瓶壁传热：Q̇ = −K (T − Tw)，热弛豫时间 τh = n Cv / K（几十秒）
//   放气阀：孔口流量按可压缩气体的亚声速孔流公式（压差小，近似 ṅ ∝ √(Δp)），阀门全开时几十毫秒量级泄压。
//   温度传感器（AD590）本身有响应时间 τs，读数滞后于气体温度。

export const R = 8.314462618;

export class GasVessel {
  /** @param {{ V:number, Tw:number, p0:number, gamma?:number, tauH?:number, orifice?:number, tauS?:number }} o SI 单位 */
  constructor(o) {
    Object.assign(this, { gamma: 1.402, tauH: 40, orifice: 2.0e-5, tauS: 2.5 }, o);
    this.Cv = R / (this.gamma - 1); this.Cp = this.Cv + R;
    this.T = this.Tw; this.n = (this.p0 * this.V) / (R * this.T); this.Ts = this.T;
    this.valve = false; this.inflow = 0; this.Tin = this.Tw; this.t = 0;
  }
  get p() { return (this.n * R * this.T) / this.V; }
  /** 放气阀的摩尔流量（mol/s，流出为负）：孔口流量 C·A·√(2ρΔp)，ρ 取瓶内气体密度 */
  outflow() {
    const dp = this.p - this.p0;
    if (!this.valve || Math.abs(dp) < 1e-6) return 0;
    const M = 0.028964, rho = (this.p * M) / (R * this.T), q = this.orifice * Math.sqrt((2 * Math.abs(dp)) / rho) * rho / M; // mol/s
    return dp > 0 ? -q : 0; // p < p0 时外界空气倒灌，这里阀门在 p ≈ p0 时就关，忽略
  }
  /** 积分 dt 秒（内部自动细分步长，阀门打开时步长很小） */
  step(dt) {
    let left = dt;
    while (left > 1e-12) {
      const open = this.valve && this.p - this.p0 > 20, h = Math.min(left, open || this.inflow ? 2e-3 : 0.05);
      const K = (this.n * this.Cv) / this.tauH, Q = -K * (this.T - this.Tw);
      const nout = this.outflow(), nin = this.inflow;
      const dT = (R * this.T * nout + (this.Cp * this.Tin - this.Cv * this.T) * nin + Q) / (this.n * this.Cv);
      this.n += (nout + nin) * h; this.T += dT * h;
      // 阀门开着且压差已很小：瓶内与大气相通，压强就是 p0（气体随温度变化自由进出）
      if (this.valve && this.p - this.p0 <= 20) this.n = (this.p0 * this.V) / (R * this.T);
      this.Ts += ((this.T - this.Ts) * h) / this.tauS;
      this.t += h; left -= h;
    }
  }
}

/** 由三个状态的压强求 γ：γ = ln(p1/p0) / ln(p1/p2) */
export const gammaOf = (p0, p1, p2) => Math.log(p1 / p0) / Math.log(p1 / p2);
