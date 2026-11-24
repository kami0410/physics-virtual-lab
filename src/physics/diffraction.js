// 衍射计算核心
// 1) 一维孔径的菲涅耳–基尔霍夫衍射积分（复合辛普森数值积分），同时适用于菲涅耳区与夫琅禾费区；
// 2) 多缝光栅的单缝衍射包络因子。

/**
 * 观察屏上 x 处的相对光强 |U|²（以入射平面波光强为 1）。
 * U(x) = (1/√(iλL)) ∫ A(ξ) exp[iπ(x−ξ)²/(λL)] dξ  （菲涅耳近似，透射函数 A 由孔径决定）
 * @param apertures [[ξ1, ξ2], ...] 透光区间 (mm)
 * @param beam {w, c} 入射高斯光束半径与中心 (mm)，w=Infinity 表示平面波
 */
export function fresnel1D(x, apertures, lambda, L, beam = { w: Infinity, c: 0 }) {
  const k = Math.PI / (lambda * L);
  let R = 0, I = 0;
  for (const [a, b] of apertures) {
    // 自适应采样：保证相邻采样点间相位变化 < π/6
    const maxDx = Math.max(Math.abs(x - a), Math.abs(x - b));
    const dphi = 2 * k * maxDx * (b - a) + k * (b - a) ** 2;
    let n = Math.max(32, Math.ceil(dphi / (Math.PI / 6)));
    if (n % 2) n++;
    const h = (b - a) / n;
    let re = 0, im = 0;
    for (let i = 0; i <= n; i++) {
      const xi = a + i * h;
      const w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2; // 辛普森权重
      const amp = beam.w === Infinity ? 1 : Math.exp(-(((xi - beam.c) / beam.w) ** 2));
      const ph = k * (x - xi) ** 2;
      re += w * amp * Math.cos(ph);
      im += w * amp * Math.sin(ph);
    }
    R += (re * h) / 3;
    I += (im * h) / 3;
  }
  return (R * R + I * I) / (lambda * L);
}

/** 单缝 / 双缝孔径 */
export function slitApertures(type, a, d = 0.25, center = 0) {
  if (type === 'double') return [[center - d / 2 - a / 2, center - d / 2 + a / 2], [center + d / 2 - a / 2, center + d / 2 + a / 2]];
  return [[center - a / 2, center + a / 2]];
}

/** 夫琅禾费单缝解析解（用于对比/数据处理） */
export function sinc2(x, a, lambda, L) {
  const u = (Math.PI * a * x) / (lambda * L);
  return Math.abs(u) < 1e-9 ? 1 : (Math.sin(u) / u) ** 2;
}

/** 光栅单缝衍射包络：缝宽 a，出射/入射方向正弦 */
export function gratingEnvelope(d, a, lambda, sOut, sIn) {
  const u = (Math.PI * a * (sOut - sIn)) / lambda;
  return Math.abs(u) < 1e-9 ? 1 : (Math.sin(u) / u) ** 2;
}
