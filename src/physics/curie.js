// 铁磁（亚铁磁）材料的居里温度：铁氧体环形样品上绕初级、次级线圈，初级通交流小电流，
// 次级感应电动势与样品的起始磁导率成正比。磁导率随温度的变化用分子场（外斯）理论的自发磁化强度描述：
//   m = tanh(m / t)，t = T/T_c（自旋 1/2 的布里渊函数），T ≥ T_c 时 m = 0；
// 起始磁导率 μ_i − 1 ∝ m²·(1 + 2t⁶)：低温段变化平缓，接近 T_c 时 m² ≈ 3(1 − t) 线性降到零，
// 高于 T_c 只剩很小的顺磁尾巴（居里–外斯定律）。

/** 分子场理论的约化自发磁化强度 m(t)，t = T/T_c */
export function meanFieldM(t) {
  if (t >= 1) return 0;
  if (t <= 0) return 1;
  let m = t > 0.5 ? Math.min(1, Math.sqrt(3 * (1 - t))) : 1;
  for (let k = 0; k < 60; k++) {
    const th = Math.tanh(m / t), f = m - th, df = 1 - (1 - th * th) / t;
    const dm = f / df; m -= dm;
    if (m <= 0) m = 1e-6;
    if (Math.abs(dm) < 1e-14) break;
  }
  return m;
}

/** 相对磁导率的温度因子（铁磁部分），T、Tc 单位 K */
export function ferroFactor(T, Tc) { const t = T / Tc, m = meanFieldM(t); return m * m * (1 + 2 * t ** 6); }

/**
 * 次级线圈感应电压（mV）
 * @param {number} T 样品温度（K）
 * @param {{Tc:number, U0:number, Ub:number, Tref:number}} o U0：参考温度 Tref 下铁磁部分贡献的电压；Ub：空气耦合的本底电压
 */
export function secondaryU(T, o) {
  const fe = (o.U0 * ferroFactor(T, o.Tc)) / ferroFactor(o.Tref, o.Tc);
  const para = T > o.Tc ? (0.004 * o.U0 * 12) / (T - o.Tc + 12) : 0.004 * o.U0;
  return o.Ub + fe + para;
}

/** 由 U–T 曲线最陡一段的切线与 T 轴的交点求居里温度。pts: [[T, U]]，按温度排序 */
export function tangentTc(pts, w = 3) {
  const P = pts.slice().sort((a, b) => a[0] - b[0]);
  const lo = Math.min(...P.map((p) => p[1])), hi = Math.max(...P.map((p) => p[1]));
  // 只在电压明显高于居里点以上的本底的点中找最陡的一段（拐点以下的点不在切线上）
  const above = (seg) => seg.every((p) => p[1] > lo + 0.03 * (hi - lo));
  let best = null;
  for (let i = 0; i + w <= P.length; i++) {
    const seg = P.slice(i, i + w), n = w;
    if (!above(seg)) continue;
    const mx = seg.reduce((s, p) => s + p[0], 0) / n, my = seg.reduce((s, p) => s + p[1], 0) / n;
    let sxy = 0, sxx = 0; for (const [x, y] of seg) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
    const k = sxy / sxx;
    if (!best || k < best.k) best = { k, b: my - k * mx, i };
  }
  if (!best && w > 2) return tangentTc(pts, 2);
  return best ? { Tc: -best.b / best.k, ...best, seg: P.slice(best.i, best.i + w) } : null;
}
