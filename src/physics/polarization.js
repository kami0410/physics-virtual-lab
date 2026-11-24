// 偏振光计算核心：斯托克斯矢量 S = [S0,S1,S2,S3] 与穆勒矩阵
// 角度均为元件主轴（透振方向/快轴）与水平方向的夹角，弧度。

const D2R = Math.PI / 180;
export const rad = (deg) => deg * D2R;
export const deg = (r) => r / D2R;

/** 部分偏振光源：光强 I，偏振度 dop，振动方向 psi */
export function sourceStokes(I, dop, psi) {
  return [I, I * dop * Math.cos(2 * psi), I * dop * Math.sin(2 * psi), 0];
}

/**
 * 实际偏振片（二向色性）：沿透振方向强度透射率 p，垂直方向 q（消光比 p/q）。
 */
export function polarizerM(theta, p = 0.85, q = 0.00085) {
  const c = Math.cos(2 * theta), s = Math.sin(2 * theta);
  const a = (p + q) / 2, b = (p - q) / 2, r = Math.sqrt(p * q);
  return [
    [a, b * c, b * s, 0],
    [b * c, a * c * c + r * s * s, (a - r) * c * s, 0],
    [b * s, (a - r) * c * s, a * s * s + r * c * c, 0],
    [0, 0, 0, r],
  ];
}

/** 线性相位延迟器（波片）：快轴方向 theta，相位延迟 delta，透射率 t */
export function retarderM(theta, delta, t = 0.97) {
  const c = Math.cos(2 * theta), s = Math.sin(2 * theta), cd = Math.cos(delta), sd = Math.sin(delta);
  return [
    [t, 0, 0, 0],
    [0, t * (c * c + s * s * cd), t * c * s * (1 - cd), -t * s * sd],
    [0, t * c * s * (1 - cd), t * (s * s + c * c * cd), t * c * sd],
    [0, t * s * sd, -t * c * sd, t * cd],
  ];
}

export function applyM(M, S) {
  return M.map((row) => row[0] * S[0] + row[1] * S[1] + row[2] * S[2] + row[3] * S[3]);
}

/** 由斯托克斯矢量求偏振椭圆：方位角 psi、椭偏角 chi（tanχ = b/a，正为右旋）、偏振度 */
export function ellipseOf(S) {
  const Ip = Math.hypot(S[1], S[2], S[3]);
  const psi = 0.5 * Math.atan2(S[2], S[1]);
  const chi = Ip > 1e-12 ? 0.5 * Math.asin(Math.max(-1, Math.min(1, S[3] / Ip))) : 0;
  return { I: S[0], psi, chi, dop: S[0] > 0 ? Ip / S[0] : 0 };
}

/** 菲涅耳反射率（入射角 th 弧度，从空气入射到折射率 n 的介质）：返回 s、p 分量的能量反射率 */
export function fresnelR(th, n) {
  const st = Math.sin(th) / n;
  if (Math.abs(st) >= 1) return { s: 1, p: 1 };
  const tt = Math.asin(st);
  if (Math.abs(th) < 1e-6) { const r = ((n - 1) / (n + 1)) ** 2; return { s: r, p: r }; }
  return { s: (Math.sin(th - tt) / Math.sin(th + tt)) ** 2, p: (Math.tan(th - tt) / Math.tan(th + tt)) ** 2 };
}
