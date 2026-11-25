// 液体表面张力：拉脱法（吊环）
//   水的表面张力随温度：IAPWS（2014）推荐式 σ = B·τ^μ·(1 + b·τ)，τ = 1 − T/Tc，B = 235.8 mN/m，b = −0.625，μ = 1.256
//   吊环（薄壁圆筒）提出液面时，内外两侧各有一圈弯月面。按二维弯月面（毛细长度 ℓc = √(σ/ρg)）：
//     液面在接触线处与水平面的夹角 ψ 与接触线高出远处液面的高度 h 满足 h = 2ℓc·sin(ψ/2)
//     每单位长度接触线上的竖直拉力 = σ·sinψ，ψ = 90° 时最大（h = √2·ℓc），之后膜不稳定，很快拉断。
//   于是总拉力 F(h) = π(D1 + D2)·σ·sinψ(h)，最大值 π(D1 + D2)σ —— 拉脱法公式的来源。

export const TC = 647.096;
/** 纯水的表面张力（N/m），Tc：摄氏温度 */
export function waterSigma(Tc) { const tau = 1 - (Tc + 273.15) / TC; return 0.2358 * Math.pow(tau, 1.256) * (1 - 0.625 * tau); }
/** 水的密度（kg/m³），0–40 °C 的经验式 */
export const waterRho = (Tc) => 1000 * (1 - ((Tc + 288.9414) / (508929.2 * (Tc + 68.12963))) * (Tc - 3.9863) ** 2);
/** 毛细长度（m） */
export const capLength = (sigma, rho, g = 9.794) => Math.sqrt(sigma / (rho * g));

/** 接触线高出液面 h（m）时的弯月面角 ψ（rad）；h 超过 2ℓc 时返回 π（膜已不可能存在） */
export function meniscusAngle(h, lc) { if (h <= 0) return 0; const s = h / (2 * lc); return s >= 1 ? Math.PI : 2 * Math.asin(s); }

/** 吊环受到的液膜拉力（N）：两侧接触线总长 π(D1 + D2) */
export function filmForce(h, { D1, D2, sigma, lc }) { return Math.PI * (D1 + D2) * sigma * Math.sin(meniscusAngle(h, lc)); }
