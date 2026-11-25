// 电磁混合磁悬浮（永磁偏置 + 电磁控制，吸引式）
// 磁路：U 形铁芯两极下各有一段气隙 g，永磁体串在磁路中，等效磁动势 N·i₀，内阻折合成气隙长度 δ（= l_m/μ_r）。
//   磁通 Φ = μ₀A·N(i + i₀)/(2g + δ)，两极吸力之和 F = Φ²/(μ₀A) = μ₀A N²(i + i₀)²/(2g + δ)²
// 线性化（工作点 g*, i*）：F ≈ F* − k_x·(g − g*) + k_i·(i − i*)
//   k_x = 4F*/(2g* + δ)（负刚度的大小），k_i = 2F*/(i* + i₀)
// 闭环（PD，电流源驱动）：m·Δg'' = −k_i(K_pΔg + K_dΔg') + k_xΔg
//   ω_n² = (k_iK_p − k_x)/m，阻尼 σ = k_iK_d/(2m)
const MU0 = 4e-7 * Math.PI;

/** 电磁吸力（N）。g：单边气隙（m），i：线圈电流（A），p = {A, N, i0, delta} */
export const force = (g, i, p) => (MU0 * p.A * (p.N * (i + p.i0)) ** 2) / (2 * g + p.delta) ** 2;

/** 吸力等于 W 时的电流（A） */
export const eqCurrent = (g, W, p) => (Math.sqrt(W / (MU0 * p.A)) * (2 * g + p.delta)) / p.N - p.i0;

/** 零电流时吸力等于 W 的气隙（m） */
export const zeroPowerGap = (W, p) => ((p.N * p.i0 * Math.sqrt(MU0 * p.A / W)) - p.delta) / 2;

/** 工作点的线性化系数 */
export function linCoef(g, i, p) {
  const F = force(g, i, p);
  return { F, kx: (4 * F) / (2 * g + p.delta), ki: (2 * F) / (i + p.i0) };
}

/**
 * 一步积分（半隐式欧拉；电流按一阶惯性跟随指令）。
 * s = {g, v, i, I, gs}，c = {mode:'pos'|'zp', Kp(A/m), Kd(A·s/m), Ki(A/(m·s)), Kz(m/(A·s)), imax, tau}，m 总质量，grav 重力加速度
 * 返回接触状态：0 悬浮，−1 吸附在磁铁上，+1 落在托架上
 */
export function step(s, c, p, m, grav, h, gmin = 0.5e-3, gmax = 15e-3) {
  const e = s.g - s.gs;
  let cmd = c.Kp * e + c.Kd * s.v + (c.mode === 'pos' ? c.Ki * s.I : 0);
  cmd = Math.max(-c.imax, Math.min(c.imax, cmd));
  s.i += (cmd - s.i) * (1 - Math.exp(-h / c.tau));
  if (c.mode === 'pos') s.I += e * h; else s.gs -= c.Kz * s.i * h;
  const a = grav - force(s.g, s.i, p) / m;
  s.v += a * h; s.g += s.v * h;
  if (s.g <= gmin) { s.g = gmin; if (s.v < 0) s.v = 0; return -1; }
  if (s.g >= gmax) { s.g = gmax; if (s.v > 0) s.v = 0; return 1; }
  return 0;
}

/** 衰减振荡的峰：返回 {fd, r}（振荡频率、相邻正峰值之比），pts = [[t, e], ...] */
export function ringMeasure(pts, minAmp = 2e-6) {
  const pk = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const [t, y] = pts[i];
    if (y > pts[i - 1][1] && y >= pts[i + 1][1] && y > minAmp) {
      // 抛物线插值求峰的时刻与高度
      const y0 = pts[i - 1][1], y2 = pts[i + 1][1], d = y0 - 2 * y + y2, dt = pts[i + 1][0] - t, u = d ? (0.5 * (y0 - y2)) / d : 0;
      pk.push([t + u * dt, y - 0.25 * (y0 - y2) * u]);
    }
  }
  if (pk.length < 3) return null;
  const n = Math.min(pk.length, 5), fd = (n - 1) / (pk[n - 1][0] - pk[0][0]);
  const r = Math.pow(pk[0][1] / pk[n - 1][1], 1 / (n - 1));
  return { fd, r, n };
}
