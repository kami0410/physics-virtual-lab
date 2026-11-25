// 冷却法测比热容用到的模型
// 1. T 型（铜–康铜）热电偶的热电势：NIST ITS-90 参考函数，0–400 °C 段，E 单位 μV，t 单位 °C。
// 2. 小圆柱样品在静止空气中的冷却：自然对流 h = 1.32·(ΔT/D)^¼（水平/竖直小圆柱的层流近似），
//    加上表面辐射 εσ(T⁴ − T₀⁴)。样品很小（Bi ≪ 0.1），按集总热容 m·c·dT/dt = −P 积分。
// 3. 比热容随温度略有变化：取文献中 0–200 °C 的线性拟合（c 单位 J/(g·K)）。

const C_T = [0, 3.8748106364e1, 3.329222788e-2, 2.0618243404e-4, -2.1882256846e-6, 1.0997880928e-8, -3.0815758772e-11, 4.547913529e-14, -2.7512901673e-17];

/** T 型热电偶热电势（mV），冷端 0 °C */
export function emfT(t) {
  let e = 0, p = 1;
  for (let i = 0; i < C_T.length; i++) { e += C_T[i] * p; p *= t; }
  return e / 1000;
}
/** 由热电势反求温度（°C），牛顿迭代 */
export function tempT(mV) {
  let t = mV / 0.0426;
  for (let i = 0; i < 20; i++) { const e = emfT(t) - mV, d = (emfT(t + 0.01) - emfT(t - 0.01)) / 0.02; t -= e / d; if (Math.abs(e) < 1e-9) break; }
  return t;
}

const SIGMA = 5.670374419e-8;
export const METALS = {
  Cu: { name: '铜', rho: 8.96, c: (t) => 0.3845 + 1.0e-4 * (t - 25) },
  Fe: { name: '铁', rho: 7.87, c: (t) => 0.449 + 2.4e-4 * (t - 25) },
  Al: { name: '铝', rho: 2.70, c: (t) => 0.897 + 4.6e-4 * (t - 25) },
};

/** 样品散热功率（W）：d、L 单位 m，T、T0 单位 °C */
export function lossPower(T, T0, { d, L, eps }) {
  const S = Math.PI * d * L + (Math.PI * d * d) / 2, dT = Math.max(0, T - T0);
  const h = dT > 0 ? 1.32 * (dT / d) ** 0.25 : 0;
  const Tk = T + 273.15, T0k = T0 + 273.15;
  return S * (h * dT + eps * SIGMA * (Tk ** 4 - T0k ** 4));
}
