// 热电子发射：理想二极管（直热式钨丝阴极 + 同轴圆筒阳极）
// 零场发射电流按理查森–杜什曼公式 I = A·S·T²·exp(−eφ/kT)；
// 阳极加速电场使表面势垒降低（肖特基效应），I_a = I·exp(0.439·√E_c / T)（E_c 单位 V/m 时系数 0.439，换成 V/cm 为 4.39）；
// 阳极电压很低时受空间电荷限制（圆筒二极管的蔡尔德–朗缪尔 3/2 次方律），两者平滑取小。

export const K_EV = 8.617333e-5; // 玻尔兹曼常量 eV/K
export const LG_E = Math.LOG10E;

/** 灯丝电流 → 灯丝温度（仪器说明书给出的标定关系，K） */
export const tempOfIf = (If) => 920 + 1600 * If;

/** 零场热电子发射电流（A）。AS：有效理查森常数 × 发射面积（A/K²），phi：逸出功（eV） */
export function richardson(T, phi, AS) {
  return AS * T * T * Math.exp(-phi / (K_EV * T));
}

/** 阴极（灯丝）表面的电场强度（V/cm）：同轴圆柱，r1 灯丝半径、r2 阳极半径（cm） */
export const cathodeField = (Ua, r1, r2) => Ua / (r1 * Math.log(r2 / r1));

/**
 * 阳极电流（A）
 * @param {number} Ua 阳极电压（V）
 * @param {number} T  灯丝温度（K）
 * @param {{phi:number, AS:number, r1:number, r2:number, kc:number}} o kc：空间电荷限制电流系数（A/V^1.5）
 */
export function anodeCurrent(Ua, T, o) {
  if (Ua <= 0) return 0;
  const Is = richardson(T, o.phi, o.AS) * Math.exp((4.39 * Math.sqrt(cathodeField(Ua, o.r1, o.r2))) / T);
  const Ic = o.kc * Ua ** 1.5, p = 3;
  return 1 / (Is ** -p + Ic ** -p) ** (1 / p);
}

/** 理查森直线法：由各温度下的零场电流求逸出功。pts: [{T, I}]，返回 {phi, fit} */
export function richardsonLine(pts) {
  const xs = pts.map((p) => 1 / p.T), ys = pts.map((p) => Math.log10(p.I / (p.T * p.T)));
  const n = xs.length, mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const k = sxy / sxx;
  return { phi: (-k * K_EV) / LG_E, k, b: my - k * mx };
}
