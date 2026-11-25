// 示波管中电子束的电偏转与纵向磁场聚焦
// 电子经加速电压 U_a 获得速度 v（按相对论动量计算）。偏转板（长 l_p、间距 d）给电子一个横向速度分量，
// 横向“偏转角” α = l_p·U_y /(2 d U_a)（非相对论近似，乘以边缘场修正因子 f），无磁场时光点位移 y = α·L。
// 在长螺线管的纵向均匀磁场 B 中，横向运动是半径随时间变化的圆周运动：以复数 z = x + iy 表示横向位移，
//   z(t) = u·(1 − e^{−iωt})/(iω)，ω = eB/(γm)，u 为横向速度。
// 渡越时间 t = L/v，令 θ = ωt，则 z = αL·(1 − e^{−iθ})/(iθ)：θ = 2π 时所有电子会聚到一点（第一次聚焦）。

export const QE = 1.602176634e-19, ME = 9.1093837015e-31, C0 = 299792458, MU0 = 1.25663706212e-6;
export const EM = QE / ME;

/** 加速电压 U（V）下电子的速度、γ（相对论） */
export function beam(U) {
  const g = 1 + (QE * U) / (ME * C0 * C0), v = C0 * Math.sqrt(1 - 1 / (g * g));
  return { v, g };
}

/** 电偏转的横向角 α（rad）：Uy 偏转电压，Ua 加速电压，o = {lp, d, f} */
export const deflAngle = (Uy, Ua, o) => (o.f * o.lp * Uy) / (2 * o.d * Ua);

/**
 * 屏上光点相对无偏转位置的位移（m），返回 [x, y]
 * @param {number} ax x 方向偏转角（rad）
 * @param {number} ay y 方向偏转角（rad）
 * @param {number} B 纵向磁场（T，可正可负）
 * @param {number} Ua 加速电压（V）
 * @param {number} L 偏转区到荧光屏的距离（m）
 */
export function spot(ax, ay, B, Ua, L) {
  const { v, g } = beam(Ua), th = ((EM / g) * B * L) / v;
  if (Math.abs(th) < 1e-9) return [ax * L, ay * L];
  // (1 − e^{−iθ})/(iθ) = [sinθ + i(cosθ − 1)]/θ
  const re = Math.sin(th) / th, im = (Math.cos(th) - 1) / th;
  return [L * (ax * re - ay * im), L * (ax * im + ay * re)];
}

/** 第 k 次聚焦所需磁场（T） */
export function focusB(Ua, L, k = 1) { const { v, g } = beam(Ua); return (2 * Math.PI * k * v * g) / (EM * L); }

/** 有限长螺线管中心的磁场系数（T/A）：B = μ0·N·I/√(L² + D²) */
export const solenoidK = (N, Ls, Ds) => (MU0 * N) / Math.hypot(Ls, Ds);
