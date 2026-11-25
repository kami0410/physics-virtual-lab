// 铁磁材料的动态磁滞回线：Jiles–Atherton 磁滞模型 + 初级回路 + 次级 RC 积分电路联立求解
//
// Jiles–Atherton 模型（D. C. Jiles, D. L. Atherton, J. Magn. Magn. Mater. 61, 48 (1986)）：
//   有效场 He = H + αM，无磁滞磁化 Man = Ms·L(He/a)，L(x) = coth x − 1/x
//   不可逆分量 dMirr/dH = (Man − Mirr)/(δk − α(Man − Mirr))，δ = sign(dH/dt)；δ(Man − Mirr) < 0 时取 0
//   M = (1 − c)Mirr + c·Man
// 写法参考了 JAmodel（romanszewczyk，MIT）与 pyjam（Ryan-O-Connor，MIT）的实现，本文件另行编写，
// 并改成“电压驱动”：初级电压 u(t) 已知，每个时间步用二分法隐式求电流 i，使
//   u = (R1 + r)·i + N1·S·dB/dt,   H = N1·i/l,   B = μ0(H + M)
// 饱和时线圈电感骤降（时间常数只有微秒量级），显式积分会发散，隐式求解才稳定。
// 次级：e2 = N2·S·dB/dt 经 R2 给 C 充电，Y = u_C ≈ N2·S·B/(R2·C)。

const MU0 = 4e-7 * Math.PI;

/** Langevin 函数及其导数（小自变量用级数，避免相消） */
function lang(x) {
  if (Math.abs(x) < 1e-3) return [x / 3 - (x * x * x) / 45, 1 / 3 - (x * x) / 15];
  const ct = 1 / Math.tanh(x);
  return [ct - 1 / x, 1 / (x * x) - ct * ct + 1];
}

export class JAMaterial {
  constructor({ Ms, a, k, alpha, c }) {
    Object.assign(this, { Ms, a, k, alpha, c });
    this.reset();
  }
  reset() { this.H = 0; this.Mirr = 0; this.M = 0; }
  /** 从当前状态把外场改到 H（一步显式欧拉），返回新的 M；commit 为真时更新状态 */
  stepTo(H, commit) {
    const { Ms, a, k, alpha, c } = this;
    const dH = H - this.H;
    const He = H + alpha * this.M;
    const Man = Ms * lang(He / a)[0];
    let Mirr = this.Mirr;
    if (dH !== 0) {
      const d = dH > 0 ? 1 : -1, diff = Man - Mirr;
      if (diff * d > 0) {
        const den = d * k - alpha * diff;
        const g = den * d > 1e-9 * k ? diff / den : diff / (d * k); // 分母变号（α 过大的非物理区）时退回简单形式
        Mirr += Math.max(0, g) * dH; // dMirr/dH ≥ 0
        if ((Man - Mirr) * d < 0) Mirr = Man; // 不越过无磁滞曲线
      }
    }
    Mirr = Math.max(-Ms, Math.min(Ms, Mirr));
    const M = (1 - c) * Mirr + c * Man;
    if (commit) { this.H = H; this.Mirr = Mirr; this.M = M; }
    return M;
  }
  B(H, M) { return MU0 * (H + M); }
}

/** 预置的样品材料（软磁铁氧体、较硬的铁氧体） */
export const SAMPLES = {
  1: { name: '样品 1（铁氧体，矫顽力较小）', Ms: 3.0e5, a: 150, k: 170, alpha: 1.2e-3, c: 0.1 },
  2: { name: '样品 2（铁氧体，矫顽力较大）', Ms: 2.6e5, a: 260, k: 330, alpha: 2.4e-3, c: 0.08 },
};

/**
 * 模拟 periods 个周期，返回最后一个周期的波形。mat 的磁化状态会被保留（可以连续调电压“退磁”）。
 * circuit: { U 有效值 V, f Hz, R1, r（初级其余电阻）, N1, N2, l, S, R2, C }
 * state:   { uC } 积分电容电压（跨调用保持）
 */
export function simulateLoop(mat, circuit, state, { periods = 3, steps = 2000 } = {}) {
  const { U, f, R1, r = 0.4, N1, N2, l, S, R2, C } = circuit;
  const T = 1 / f, dt = T / steps, w = 2 * Math.PI * f, Rt = R1 + r;
  const out = { T, x: new Float64Array(steps), y: new Float64Array(steps), H: new Float64Array(steps), B: new Float64Array(steps), i: new Float64Array(steps) };
  const t0 = state.t || 0;
  let i = (mat.H * l) / N1, Bn = mat.B(mat.H, mat.M), uC = state.uC || 0;
  for (let p = 0; p < periods; p++) {
    for (let s = 0; s < steps; s++) {
      const t = t0 + (p * steps + s + 1) * dt;
      const u = Math.SQRT2 * U * Math.sin(w * t);
      // 隐式求 i：f(i) = Rt·i + N1·S·(B(i) − Bn)/dt − u，单调递增
      const F = (ii) => { const H = (N1 * ii) / l; return Rt * ii + (N1 * S * (mat.B(H, mat.stepTo(H, false)) - Bn)) / dt - u; };
      let lo = i - 0.05, hi = i + 0.05;
      let flo = F(lo), fhi = F(hi);
      for (let g = 0; flo > 0 && g < 40; g++) { lo -= (hi - lo); flo = F(lo); }
      for (let g = 0; fhi < 0 && g < 40; g++) { hi += (hi - lo); fhi = F(hi); }
      for (let it = 0; it < 48; it++) { const m = (lo + hi) / 2, fm = F(m); if (fm > 0) hi = m; else lo = m; if (hi - lo < 1e-9) break; }
      i = (lo + hi) / 2;
      const H = (N1 * i) / l, M = mat.stepTo(H, true), B = mat.B(H, M);
      const e2 = (N2 * S * (B - Bn)) / dt;
      uC += ((e2 - uC) / (R2 * C)) * dt; // R2·C ≫ dt
      Bn = B;
      if (p === periods - 1) { out.x[s] = R1 * i; out.y[s] = uC; out.H[s] = H; out.B[s] = B; out.i[s] = i; }
    }
  }
  state.uC = uC; state.t = t0 + periods * T;
  // 积分电容的起始电压按 R2·C（约 0.2 s）衰减，真实仪器开机一两秒后就看不出了；这里直接取稳态（去掉直流分量）
  let my = 0; for (let s = 0; s < steps; s++) my += out.y[s];
  my /= steps; for (let s = 0; s < steps; s++) out.y[s] -= my;
  state.uC -= my;
  return out;
}

/** 由一个周期的 (H, B) 求回线参数：Hm、Bm、Br、Hc */
export function loopParams(H, B) {
  const n = H.length;
  let im = 0; for (let j = 0; j < n; j++) if (Math.abs(H[j]) > Math.abs(H[im])) im = j;
  const cross = (X, Y) => { const v = []; for (let j = 0; j < n; j++) { const a = X[j], b = X[(j + 1) % n]; if ((a <= 0 && b > 0) || (a >= 0 && b < 0)) { const fr = a / (a - b); v.push(Math.abs(Y[j] + (Y[(j + 1) % n] - Y[j]) * fr)); } } return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0; };
  return { Hm: Math.abs(H[im]), Bm: Math.abs(B[im]), Br: cross(H, B), Hc: cross(B, H) };
}
