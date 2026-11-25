// 竖直弹簧振子：弹簧本身有质量 m_s（沿长度均匀分布），上端固定，下端挂质量 M。
// 把弹簧当作连续弹性杆，纵波方程加边界条件，基频满足 β·tan β = m_s/M，ω = β·√(k/m_s)。
// m_s ≪ M 时 ω² ≈ k/(M + m_s/3)，即弹簧的“有效质量”约为 m_s/3。

/** 基频圆频率（rad/s） */
export function springOmega(k, ms, M) {
  if (ms <= 0) return Math.sqrt(k / M);
  const r = ms / M;
  // β 在 (0, π/2) 内，β tan β 单调递增，二分求根
  let lo = 0, hi = Math.PI / 2;
  for (let i = 0; i < 100; i++) { const b = (lo + hi) / 2; if (b * Math.tan(b) > r) hi = b; else lo = b; }
  return ((lo + hi) / 2) * Math.sqrt(k / ms);
}

/** 由精确频率反推的“有效质量”（kg）：k/ω² − M */
export const effMass = (k, ms, M) => k / springOmega(k, ms, M) ** 2 - M;
