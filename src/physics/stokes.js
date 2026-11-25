// 落球法：小球在圆筒中液体里下落的收尾速度。
// 阻力 F = 6πηav · K_wall · K_bottom(h) · (1 + 3Re/16)
//   K_wall：圆筒壁修正，用 Faxén 公式 1/(1 − 2.104λ + 2.09λ³ − 0.95λ⁵)，λ = d/D；偏离轴线时再增大；
//   K_bottom：离筒底高度 h 处的 Lorentz 修正 1 + 9a/(8h)；
//   (1 + 3Re/16)：Oseen 惯性修正，Re = ρ₀vd/η。
// 教材的公式用的是经验的 Ladenburg 修正 (1+2.4d/D)(1+1.6d/H)，与这里的“真实”模型有约 0.5% 的系统差，这正是实际实验的情况。

/** 蓖麻油黏度随温度变化（Arrhenius 型），T 为摄氏温度；k 为批次系数 */
export function castorEta(T, k = 1) { return 0.986 * k * Math.exp(7286 * (1 / (T + 273.15) - 1 / 293.15)); }
/** 蓖麻油密度 kg/m³ */
export function castorRho(T) { return 961 - 0.66 * (T - 20); }

export function wallFaxen(lam) { return 1 / (1 - 2.104 * lam + 2.09 * lam ** 3 - 0.95 * lam ** 5); }

/**
 * 收尾速度 v（m/s）。d：球径 m；rho：球密度；rho0、eta：液体；D：筒内径；h：球心离筒底高度；ecc：偏心率 e/R（0–1）
 */
export function terminalV({ d, rho, rho0, eta, D, h = Infinity, ecc = 0, g = 9.794 }) {
  const a = d / 2;
  const Kw = wallFaxen(d / D) * (1 + 2.104 * (d / D) * 1.4 * ecc * ecc);
  const Kb = 1 + (9 * a) / (8 * Math.max(h, 2 * a));
  const v0 = (2 * (rho - rho0) * g * a * a) / (9 * eta * Kw * Kb);
  let v = v0;
  for (let i = 0; i < 30; i++) { const Re = (rho0 * v * d) / eta; v = v0 / (1 + (3 * Re) / 16); }
  return v;
}
