// 准稳态法：四块相同的样品叠在一起，两片加热膜分别夹在第 1、2 块和第 3、4 块之间。
// 由对称性只算一半：x = 0 为中心面（绝热对称面），x = R 处为加热膜（热流密度 2q_c，一半向内、一半向外），
// x = 2R 为外表面（经保温层以很小的传热系数 h 向室温散热）。
// 一维导热方程用有限体积 + Crank–Nicolson 推进；加热膜本身有一点热容。
// 准稳态时：中心面与加热面的温差 ΔT = q_c R/(2λ)，各处升温速率 dT/dt = q_c/(ρcR)。

export class QuasiSlab {
  /** @param {{R:number, lam:number, rho:number, c:number, T0:number, h?:number, Ch?:number, n?:number}} o SI 单位 */
  constructor(o) {
    Object.assign(this, { h: 0.5, Ch: 250, n: 24 }, o);
    this.N = 2 * this.n; this.dx = this.R / this.n;
    this.T = new Float64Array(this.N + 1).fill(this.T0);
    this.q = 0; this.t = 0;
    const N = this.N, rc = this.rho * this.c * this.dx;
    this.C = Float64Array.from({ length: N + 1 }, (_, i) => (i === 0 || i === N ? rc / 2 : rc) + (i === this.n ? this.Ch : 0));
    this.G = this.lam / this.dx;
  }
  /** 推进 dt（s）；q 为单个加热膜每一面的热流密度 q_c（W/m²），加热膜总发热 2q_c */
  step(dt) {
    const N = this.N, T = this.T, C = this.C, G = this.G, h = this.h;
    const a = new Float64Array(N + 1), b = new Float64Array(N + 1), c = new Float64Array(N + 1), d = new Float64Array(N + 1);
    for (let i = 0; i <= N; i++) {
      const gl = i > 0 ? G : 0, gr = i < N ? G : 0, ge = i === N ? h : 0;
      const src = (i === this.n ? 2 * this.q : 0) + ge * this.T0;
      const rhsFlux = (gl ? gl * (T[i - 1] - T[i]) : 0) + (gr ? gr * (T[i + 1] - T[i]) : 0) - ge * T[i];
      a[i] = -0.5 * dt * gl; c[i] = -0.5 * dt * gr; b[i] = C[i] + 0.5 * dt * (gl + gr + ge);
      d[i] = C[i] * T[i] + 0.5 * dt * rhsFlux + dt * src;
    }
    // Thomas 算法
    for (let i = 1; i <= N; i++) { const m = a[i] / b[i - 1]; b[i] -= m * c[i - 1]; d[i] -= m * d[i - 1]; }
    T[N] = d[N] / b[N];
    for (let i = N - 1; i >= 0; i--) T[i] = (d[i] - c[i] * T[i + 1]) / b[i];
    this.t += dt;
  }
  advance(dt) { const n = Math.max(1, Math.ceil(dt / 0.5)), h = dt / n; for (let k = 0; k < n; k++) this.step(h); }
  get Tc() { return this.T[0]; }
  get Ts() { return this.T[this.n]; }
}
