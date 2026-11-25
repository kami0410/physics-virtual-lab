// 硅光电二极管的光电特性
// 以"反向电流"为正：Ir(U) = I_ph + I_s(1 − e^{−U/(nV_T)}) + I_g√U + U/R_sh，U 为反向电压（U < 0 即正偏）。
//   I_ph = S·E（光电流与照度成正比），I_s(1 − e^{…}) 是扩散电流，I_g√U 是耗尽区的产生电流（随耗尽层宽度增大），R_sh 为并联漏电阻。
// 开路电压：接内阻 R_in 的电压表时，外电路电流 V/R_in 恰好等于二极管的反向电流。
// 时间响应：负载电阻 R_L 与结电容 C_j(U) = C_j0/√(1+U/V_bi) 加示波器输入电容构成一阶 RC，
//   再串联一个很短的载流子渡越时间常数 τ₂，输出取两极点阶跃响应。
export const QE = 1.602176634e-19, KB = 1.380649e-23;
export const VT = (T) => (KB * T) / QE;

/** 反向电流（A）。o = {Iph, Is, n, Ig, Rsh, T} */
export function reverseCurrent(U, o) {
  return o.Iph + o.Is * (1 - Math.exp(-U / (o.n * VT(o.T)))) + (U > 0 ? o.Ig * Math.sqrt(U) : 0) + U / o.Rsh;
}

/** 串联电阻 R 接电源 Us（反偏）时二极管上的反向电压与电流：U = Us − Ir·R */
export function biasPoint(Us, R, o) {
  let lo = -1.2, hi = Math.max(Us, 0) + 1e-9;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (m - Us + reverseCurrent(m, o) * R > 0) hi = m; else lo = m; }
  const U = (lo + hi) / 2;
  return { U, I: reverseCurrent(U, o) };
}

/** 接内阻 Rin 的电压表时的开路电压（V，正值，阳极为正） */
export function openVoltage(Rin, o) {
  let lo = -1.2, hi = 0;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (reverseCurrent(m, o) + m / Rin > 0) hi = m; else lo = m; }
  return -(lo + hi) / 2;
}

/** 结电容（F） */
export const junctionC = (U, Cj0, Vbi = 0.7) => Cj0 / Math.sqrt(1 + Math.max(U, 0) / Vbi);

/** 两极点阶跃响应（0→1），τ1 ≠ τ2 */
export function stepResp(t, t1, t2) {
  if (t <= 0) return 0;
  if (Math.abs(t1 - t2) < 1e-6 * t1) t2 = t1 * (1 - 1e-6);
  return 1 - (t1 * Math.exp(-t / t1) - t2 * Math.exp(-t / t2)) / (t1 - t2);
}

/** 10%–90% 上升时间 */
export function riseTime(t1, t2) {
  const at = (y) => { let lo = 0, hi = 30 * (t1 + t2); for (let i = 0; i < 90; i++) { const m = (lo + hi) / 2; if (stepResp(m, t1, t2) > y) hi = m; else lo = m; } return (lo + hi) / 2; };
  return at(0.9) - at(0.1);
}
