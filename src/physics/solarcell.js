// 硅太阳能电池的单二极管模型
//   I = I_L − I₀[exp((U + I·R_s)/(nV_T)) − 1] − (U + I·R_s)/R_sh
// U 为端电压，I 为向外电路输出的电流（向外为正）；I_L 正比于辐照度。V_T = kT/q。
// 隐式方程对 I 单调，用二分法求解；接负载、接外加电源时再对端电压二分。

export const KB = 1.380649e-23, QE = 1.602176634e-19;

/** 端电压为 U 时电池输出的电流（A） */
export function cellI(U, c) {
  const a = (c.n * KB * c.T) / QE;
  const f = (I) => c.IL - c.I0 * Math.expm1((U + I * c.Rs) / a) - (U + I * c.Rs) / c.Rsh - I;
  let lo = -50, hi = c.IL + 1;
  for (let k = 0; k < 200; k++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; if (hi - lo < 1e-13) break; }
  return (lo + hi) / 2;
}
/** 开路电压（V） */
export function cellUoc(c) { let lo = 0, hi = 2; for (let k = 0; k < 100; k++) { const m = (lo + hi) / 2; if (cellI(m, c) > 0) lo = m; else hi = m; } return (lo + hi) / 2; }
/** 接负载电阻 R（Ω，可为 Infinity）时的工作点 {U, I} */
export function withLoad(R, c) {
  if (!(R < Infinity)) { const U = cellUoc(c); return { U, I: 0 }; }
  let lo = 0, hi = Math.max(cellUoc(c), 0) + 1e-9;
  if (c.IL <= 0) return { U: 0, I: 0 };
  for (let k = 0; k < 100; k++) { const m = (lo + hi) / 2; if (cellI(m, c) - m / R > 0) lo = m; else hi = m; }
  const U = (lo + hi) / 2;
  return { U, I: cellI(U, c) };
}
/** 外加电源 E（V）经串联电阻 R（Ω）加在电池上（正极接正极）时的端电压与流入电池的电流 */
export function withSupply(E, R, c) {
  let lo = -1, hi = Math.max(E, 0) + 1;
  for (let k = 0; k < 120; k++) { const m = (lo + hi) / 2; if (-cellI(m, c) - (E - m) / R > 0) hi = m; else lo = m; }
  const U = (lo + hi) / 2;
  return { U, I: -cellI(U, c) };
}
