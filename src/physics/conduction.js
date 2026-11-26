// 稳态平板法（Lee 盘法）测不良导体导热系数的热学模型。
//   发热盘 A（铜，带 PI 温控）│ 样品 B（橡胶圆盘，沿厚度分 N 层作一维有限差分，计入热容）│ 散热盘 P（铜）
//   A、B、P 之间有接触热阻；P 向周围空气散热：自然对流 + 辐射，朝上、朝下、侧面的对流系数不同
//   （教材公式假定各表面散热系数相同，用面积比 (R+2h)/(2R+2h) 修正，二者的差别是本实验主要的系统误差之一）。
// 状态：'stack' A-B-P 叠放加热；'AP' 移去 B，A 直接加热 P；'P' 移去 A，P 单独在空气中冷却（上表面暴露）。

const SIGMA = 5.670e-8;

/** 水平面自然对流系数 W/(m²·K)。dir：'up' 热面朝上，'down' 热面朝下，'side' 竖直面 */
export function hConv(dT, dir = 'up', L = 0.13) {
  if (dT <= 0) return 0;
  const base = 1.32 * (dT / L) ** 0.25; // 空气，层流近似
  return base * (dir === 'up' ? 1 : dir === 'down' ? 0.94 : 0.97);
}
export function hRad(T, Ta, eps) {
  const t = T + 273.15, a = Ta + 273.15;
  return Math.abs(t - a) < 1e-9 ? 4 * eps * SIGMA * t ** 3 : (eps * SIGMA * (t ** 4 - a ** 4)) / (t - a);
}

export class LeeDisc {
  /**
   * @param {object} p lam 样品导热系数；rc 样品体积热容 J/(m³K)；hB、RB 样品厚度、半径；
   *   mP、cP、RP、hP 散热盘质量、比热、半径、厚度；CA 发热盘热容；Gc 接触换热系数 W/(m²K)；eps 散热盘发射率；Ta 室温
   */
  constructor(p) {
    Object.assign(this, { N: 8, Pmax: 90, GA: 0.12, Gc: 4000, eps: 0.2, Ta: 20, fc: 1 }, p); // fc：样品与铜盘的接触面积比例（放偏时 < 1）
    this.TA = this.Ta; this.TP = this.Ta; this.TB = new Array(this.N).fill(this.Ta);
    this.set = 75; this.on = false; this.integ = 0; this.mode = 'stack'; this.power = 0; this.t = 0;
  }
  get AB() { return Math.PI * this.RB ** 2; }
  get AP() { return Math.PI * this.RP ** 2; }
  get CP() { return this.mP * this.cP; }
  /** 散热盘向空气的散热功率；top：上表面是否暴露 */
  lossP(T, top) {
    const d = T - this.Ta, hr = hRad(T, this.Ta, this.eps), A = this.AP, As = 2 * Math.PI * this.RP * this.hP;
    let q = (hConv(d, 'down') + hr) * A * d + (hConv(d, 'side') + hr) * As * d;
    if (top) q += (hConv(d, 'up') + hr) * A * d;
    return q;
  }
  /** 一步积分（显式），dt ≤ 1 s */
  step(dt) {
    const { N, lam, rc, hB, AB } = this, dx = hB / N;
    // 温控：PI，按 A 的温度
    if (this.on) {
      const e = this.set - this.TA;
      this.integ = Math.max(-50, Math.min(400, this.integ + e * dt));
      this.power = Math.max(0, Math.min(this.Pmax, 12 * e + 0.05 * this.integ));
    } else { this.power = 0; this.integ = 0; }
    let qA = this.power - this.GA * (this.TA - this.Ta), qP = 0;
    if (this.mode === 'stack') {
      // 接触热阻 + 半层样品
      const gEnd = 1 / (1 / this.Gc + dx / 2 / lam) * AB * this.fc, gIn = (lam / dx) * AB;
      const T = this.TB, C = rc * AB * dx, f = new Array(N).fill(0);
      const qTop = gEnd * (this.TA - T[0]), qBot = gEnd * (T[N - 1] - this.TP);
      f[0] += qTop; f[N - 1] -= qBot;
      for (let i = 0; i < N - 1; i++) { const q = gIn * (T[i] - T[i + 1]); f[i] -= q; f[i + 1] += q; }
      for (let i = 0; i < N; i++) T[i] += (f[i] / C) * dt;
      qA -= qTop; qP += qBot - this.lossP(this.TP, false);
      this.qB = qBot;
    } else {
      // 样品在一边空气中冷却（简化：整体向室温弛豫）
      for (let i = 0; i < N; i++) this.TB[i] += (this.Ta - this.TB[i]) * Math.min(1, dt / 900);
      if (this.mode === 'AP') {
        const q = this.Gc * 0.6 * Math.min(this.AB, this.AP) * (this.TA - this.TP);
        qA -= q; qP += q - this.lossP(this.TP, false);
      } else qP -= this.lossP(this.TP, true);
    }
    this.TA += (qA / this.CA) * dt;
    this.TP += (qP / this.CP) * dt;
    this.t += dt;
  }
  advance(T) { let n = Math.ceil(T / 1); const h = T / Math.max(1, n); while (n-- > 0) this.step(h); }
}

/** 教材公式 λ = m c (dT/dt) (R_P + 2h_P)/(2R_P + 2h_P) · h_B / (π R_B² (T1 − T2)) */
export function leeLambda({ m, c, rate, RP, hP, hB, RB, T1, T2 }) {
  return (m * c * rate * (RP + 2 * hP)) / (2 * RP + 2 * hP) * hB / (Math.PI * RB * RB * (T1 - T2));
}
