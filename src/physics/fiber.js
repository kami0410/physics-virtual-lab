// 阶跃折射率多模光纤的耦合、远场与损耗
// 耦合：激光经显微物镜会聚成高斯光斑（束腰 w0，瑞利长度 zR），光纤端面相对焦点偏移 (dx, dy, dz)。
//   进入纤芯的功率份额 = 光斑强度在纤芯圆（半径 a）内的积分；会聚光束的发散角远小于光纤的数值孔径，角度上全部被接收。
// 远场：满注入的多模光纤，出射光强随角度的分布取 I(θ) = (1 − (sinθ/NA₀)²)^0.7，强度降到中心 5% 的角度就是数值孔径 NA。
// 弯曲损耗：每绕一圈的附加损耗随弯曲半径按指数下降 Δ = A·exp(−R/R₀)（dB/圈）。

/** 高斯光斑（1/e² 半径 w）在偏心 d 的圆（半径 a）内的功率份额，极坐标数值积分 */
export function circleFraction(w, a, d) {
  const nr = 40, nt = 64; let s = 0;
  for (let i = 0; i < nr; i++) {
    const r = ((i + 0.5) / nr) * a, dr = a / nr;
    let st = 0;
    for (let j = 0; j < nt; j++) { const t = ((j + 0.5) / nt) * 2 * Math.PI, x = r * Math.cos(t) - d, y = r * Math.sin(t); st += Math.exp((-2 * (x * x + y * y)) / (w * w)); }
    s += st * (2 * Math.PI / nt) * r * dr;
  }
  return Math.min(1, (2 / (Math.PI * w * w)) * s);
}

/** 偏离焦点 (dx, dy, dz) 时的耦合份额（不含端面反射）。o = {w0, zR, a}，长度单位一致 */
export function coupleFraction(dx, dy, dz, o) {
  const w = o.w0 * Math.sqrt(1 + (dz / o.zR) ** 2);
  return circleFraction(w, o.a, Math.hypot(dx, dy));
}

const P = 0.7, K5 = Math.sqrt(1 - 0.05 ** (1 / P)); // 5% 强度点对应的 sinθ/NA₀
/** 远场相对光强（0–1）。NA 为 5% 强度点的数值孔径 */
export function farField(theta, NA) {
  const x = Math.sin(Math.abs(theta)) / (NA / K5);
  return x >= 1 ? 0 : (1 - x * x) ** P;
}

/** 屏上光斑（5% 强度）的直径：屏到光纤端面距离 z、纤芯直径 dc */
export const spotDiameter = (z, NA, dc = 0) => dc + 2 * z * Math.tan(Math.asin(NA));

/** 弯曲损耗（dB/圈） */
export const bendLoss = (R, A, R0) => A * Math.exp(-R / R0);
