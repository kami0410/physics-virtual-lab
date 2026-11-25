// 密立根油滴：油滴在平行板电容器中受重力、浮力、电场力和空气阻力（斯托克斯阻力 + 坎宁汉滑移修正）。
//   收尾速度（向下为正）  v = (m'g − qU/d) / (6π η' a)，  m' = 4/3·πa³(ρ − ρ_air)，  η' = η / (1 + b/(p·a))
//   空气黏度按 Sutherland 公式随温度变化；布朗运动扩散系数 D = kT / (6π η' a)。
//   静态（平衡）法的教科书公式（用未修正的 η 求 a，再代入修正项）：
//     a = √(9ηl / (2ρg t_g)),  q = 18π/√(2ρg) · [ηl / (t_g(1 + b/(pa)))]^{3/2} · d/U

export const E0 = 1.602176634e-19; // 元电荷 C
export const KB = 1.380649e-23;
export const B_CUNN = 8.23e-3; // 坎宁汉修正常数 b（Pa·m）= 6.17×10⁻⁶ m·cmHg

/** 空气黏度（Pa·s），Sutherland 公式 */
export const airEta = (Tc) => { const T = Tc + 273.15; return (1.716e-5 * Math.pow(T / 273.15, 1.5) * (273.15 + 110.4)) / (T + 110.4); };
/** 空气密度（kg/m³） */
export const airRho = (Tc, p) => (p * 0.0289644) / (8.314462618 * (Tc + 273.15));

/** 油滴的收尾速度（m/s，向下为正）；U 为两板电压（上板为正时对负电荷… 这里 q 取正值，U > 0 表示电场力向上） */
export function dropV({ a, q, U, d, rho, Tc = 20, p = 101325, g = 9.794 }) {
  const eta = airEta(Tc) / (1 + B_CUNN / (p * a));
  const m = (4 / 3) * Math.PI * a ** 3 * (rho - airRho(Tc, p));
  return (m * g - (q * U) / d) / (6 * Math.PI * eta * a);
}
/** 平衡电压（V） */
export function balanceU({ a, q, d, rho, Tc = 20, p = 101325, g = 9.794 }) {
  const m = (4 / 3) * Math.PI * a ** 3 * (rho - airRho(Tc, p));
  return (m * g * d) / q;
}
/** 布朗运动扩散系数（m²/s） */
export const diffusion = ({ a, Tc = 20, p = 101325 }) => (KB * (Tc + 273.15)) / (6 * Math.PI * (airEta(Tc) / (1 + B_CUNN / (p * a))) * a);

/** 静态法教科书公式：由平衡电压 U、匀速下落 l 所需时间 tg 求电荷量 */
export function chargeStatic({ U, tg, l, d, rho, Tc = 20, p = 101325, g = 9.794 }) {
  const eta = airEta(Tc);
  const a = Math.sqrt((9 * eta * l) / (2 * rho * g * tg));
  return ((18 * Math.PI) / Math.sqrt(2 * rho * g)) * Math.pow((eta * l) / (tg * (1 + B_CUNN / (p * a))), 1.5) * (d / U);
}
