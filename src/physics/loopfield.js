// 圆电流环的磁场（精确解，任意场点）
//
// 核心算法移植自 Magpylib（BSD-2-Clause，Copyright (c) 2022, Silicon Austria Labs,
// Magpylib Developers，许可全文见 licenses/magpylib-LICENSE.txt）：
//   magpylib/_src/fields/field_BH_circle.py   current_circle_Hfield
//   magpylib/_src/fields/special_cel.py       _cel_iter
// 出处：F. Ortner, M. Ortner 等，Numerically stable and computationally efficient expression
// for the magnetic field of a current loop, MDPI Magnetism 3(1), 11-31 (2023)。
// 用 Bulirsch 的广义完全椭圆积分 cel 一次写出 H_r、H_z，在轴上、远场、靠近导线处都不会出现
// 0/0 或大数相减，比教材上 K(k)、E(k) 的写法稳定。

export const MU0 = 4e-7 * Math.PI;

// Bulirsch cel(kc, p, c, s) 的迭代核（Magpylib 的 _cel_iter，逐点版）
function celIter(qc, p, g, cc, ss, em, kk) {
  for (let it = 0; it < 60 && Math.abs(g - qc) >= g * 1e-8; it++) {
    qc = 2 * Math.sqrt(kk);
    kk = qc * em;
    const f = cc;
    cc += ss / p;
    g = kk / p;
    ss = 2 * (ss + f * g);
    p += g;
    g = em;
    em += qc;
  }
  return 1.5707963267948966 * (ss + cc * em) / (em * (em + p));
}

// 半径 r0 的单匝电流环位于 z=0 平面、圆心在原点，电流 i0 沿 +φ 方向。
// 场点柱坐标 (r ≥ 0, z)，返回 [H_r, H_z]（A/m）。导线上（r = r0, z = 0）返回 0。
export function loopH(r0, r, z, i0 = 1) {
  r = Math.abs(r) / r0;
  z /= r0;
  if (Math.abs(r - 1) < 1e-12 && Math.abs(z) < 1e-12) return [0, 0];
  const z2 = z * z;
  const x0 = z2 + (r + 1) * (r + 1);
  const k2 = 4 * r / x0;
  const q2 = (z2 + (r - 1) * (r - 1)) / x0;
  const q = Math.sqrt(q2);
  const p = 1 + q;
  const pf = i0 / (4 * Math.PI * r0 * Math.sqrt(x0) * q2);
  let cc = k2 * 4 * z / x0;
  let ss = 2 * cc * q / p;
  const Hr = pf * celIter(q, p, 1, cc, ss, p, q);
  const k4 = k2 * k2;
  cc = k4 - (q2 + 1) * (4 / x0);
  ss = 2 * q * (k4 / p - (4 / x0) * p);
  const Hz = -pf * celIter(q, p, 1, cc, ss, p, q);
  return [Hr, Hz];
}

// 一组同轴线圈（轴为 z）在场点 (x, y, z) 的磁感应强度 [Bx, By, Bz]（T）。
// coil: { R 半径 m, N 匝数, I 电流 A, z 中心位置 m, w 绕组轴向宽度 m（可选，按 5 层均分近似）}
export function coilsB(coils, x, y, z) {
  const rho = Math.hypot(x, y);
  let Br = 0, Bz = 0;
  for (const c of coils) {
    const layers = c.w ? 5 : 1;
    for (let k = 0; k < layers; k++) {
      const dz = layers > 1 ? (k / (layers - 1) - 0.5) * c.w : 0;
      const [hr, hz] = loopH(c.R, rho, z - c.z - dz, c.I * c.N / layers);
      Br += hr; Bz += hz;
    }
  }
  Br *= MU0; Bz *= MU0;
  return rho > 0 ? [Br * x / rho, Br * y / rho, Bz] : [0, 0, Bz];
}

// 教材公式：单匝圆电流在轴线上的 B_z
export const axisB = (R, I, z) => MU0 * I * R * R / (2 * Math.pow(R * R + z * z, 1.5));
