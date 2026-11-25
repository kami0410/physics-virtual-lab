// 塞曼效应：汞 546.1 nm（7³S₁ → 6³P₂）谱线在磁场中的反常塞曼分裂，用法布里–珀罗标准具观察
//
// 能级移动 ΔE = M·g·μB·B，谱线波数移动 Δσ = (M₂g₂ − M₁g₁)·L，洛伦兹单位 L = eB/(4πmc)
//   上能级 ³S₁：J = 1，g₂ = 2；下能级 ³P₂：J = 2，g₁ = 3/2
//   π 成分（ΔM = 0）：M₂g₂ − M₁g₁ = −1/2, 0, +1/2；σ 成分（ΔM = ±1）：±1, ±3/2, ±2，共 9 条
//   相对强度按 J → J+1 跃迁的 Condon–Shortley 公式：π (J+1)² − M²；σ (J ± M + 1)(J ± M + 2)/4
// 标准具：2dσ·cosθ = k，经焦距 f 的透镜成像为一组同心圆环，直径 D = 2f·tanθ。
//   同一级中两成分：Δσ = (D_b² − D_a²) / [2d·(D_{k−1}² − D_k²)]，代入 Δσ = Δ(Mg)·eB/(4πmc) 求 e/m。

export const EM_TRUE = 1.75882001e11; // C/kg
export const C_LIGHT = 2.99792458e8; // m/s
export const LAM0 = 546.0735e-9; // m（空气中）

/** 洛伦兹单位（m⁻¹） */
export const lorentz = (B, em = EM_TRUE) => (em * B) / (4 * Math.PI * C_LIGHT);

const comps = () => {
  const out = [], g2 = 2, g1 = 1.5;
  for (const M of [-1, 0, 1]) {
    out.push({ pol: 'pi', s: M * g2 - M * g1, w: 4 - M * M });
    out.push({ pol: 'sigma', s: M * g2 - (M + 1) * g1, w: ((1 + M + 1) * (1 + M + 2)) / 4 });
    out.push({ pol: 'sigma', s: M * g2 - (M - 1) * g1, w: ((1 - M + 1) * (1 - M + 2)) / 4 });
  }
  return out.sort((a, b) => a.s - b.s);
};
/** 9 条分量：s 为 Δ(Mg)（单位 L），w 为相对强度，pol 为偏振（横向观察时 π ∥ B，σ ⊥ B） */
export const HG546 = comps();

/** 中心处的级次 2dσ（σ 为真空波数 m⁻¹，d 为间隔 m）；最内亮环的级次 k = floor(2dσ₀)，向外依次 k−1、k−2… */
export const centerOrder = (sigma, d) => 2 * d * sigma;
/** 第 k 级亮环中、波数为 sigma 的分量的角半径 θ（rad）：2dσ·cosθ = k */
export function ringTheta(k, sigma, d) { const c = k / (2 * d * sigma); return c <= 1 ? Math.acos(c) : NaN; }

/** Airy 透射函数在相位区间 [δ − h/2, δ + h/2] 上的平均（解析积分，防止细密条纹混叠） */
export function airyAvg(d, h, F) {
  if (h < 1e-3) { const s = Math.sin(d / 2); return 1 / (1 + F * s * s); }
  const q = Math.sqrt(1 + F);
  const G = (x) => (2 / q) * (Math.atan(q * Math.tan(x / 2)) + Math.PI * Math.floor((x + Math.PI) / (2 * Math.PI)));
  return (G(d + h / 2) - G(d - h / 2)) / h;
}
