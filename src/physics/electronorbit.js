// 电子在磁场中的轨道（精细射束管测 e/m）
//   亥姆霍兹线圈的磁场用 physics/loopfield.js 的精确电流环公式（不是均匀场），再叠加地磁场；
//   电子从枪口以动能 eU 出射，用 Boris 算法积分相对论运动方程 dp/dt = −e v × B（Boris 推进器保持 |p| 不变）。
//   坐标（m）：x 向右、y 向上、z 沿线圈轴；线圈中心在原点。

import { coilsB } from './loopfield.js';

export const QE = 1.602176634e-19, ME = 9.1093837015e-31, C0 = 299792458;
export const EM = QE / ME; // 1.75882001e11 C/kg

/** 动能 eU 的电子的动量大小（kg·m/s） */
export function momentum(U) { const K = QE * U, E = K + ME * C0 * C0; return Math.sqrt(E * E - (ME * C0 * C0) ** 2) / C0; }

/**
 * 积分一条电子轨道。
 * @param {{ U:number, coils:object[], BE?:number[], start:number[], dir:number[], bulb?:{c:number[], r:number}, maxTurn?:number, n?:number }} o
 * @returns {{ pts:number[][], hitX:number|null, hitAt:number|null, end:string }}
 *   hitX：电子第一次回到枪口高度（y = start.y，向下穿过）时的 x —— 即“打到第几厘米的标记”
 */
export function traceOrbit(o) {
  const { U, coils, BE = [0, 0, 0], start, dir, bulb, maxTurn = 1.05, n = 360 } = o;
  const p0 = momentum(U), gam = Math.sqrt(1 + (p0 / (ME * C0)) ** 2), v0 = p0 / (gam * ME);
  const B = (x, y, z) => { const b = coilsB(coils, x, y, z); return [b[0] + BE[0], b[1] + BE[1], b[2] + BE[2]]; };
  const b0 = B(...start), Bm = Math.hypot(...b0) || 1e-9;
  const Tc = (2 * Math.PI * gam * ME) / (QE * Bm); // 回旋周期
  const dt = Tc / n, nmax = Math.ceil(n * maxTurn);
  const dn = Math.hypot(...dir);
  let x = start[0], y = start[1], z = start[2];
  let ux = (dir[0] / dn) * v0 * gam, uy = (dir[1] / dn) * v0 * gam, uz = (dir[2] / dn) * v0 * gam; // u = γv
  const pts = [[x, y, z]];
  let hitX = null, hitAt = null, end = 'turns', top = false;
  const q = (-QE / ME) * dt / 2;
  for (let i = 0; i < nmax; i++) {
    // Boris：半步推进位置 → 旋转速度 → 再半步
    const g1 = Math.sqrt(1 + (ux * ux + uy * uy + uz * uz) / (C0 * C0));
    const xm = x + (ux / g1) * dt / 2, ym = y + (uy / g1) * dt / 2, zm = z + (uz / g1) * dt / 2;
    const [bx, by, bz] = B(xm, ym, zm), f = q / g1;
    const tx = f * bx, ty = f * by, tz = f * bz, t2 = tx * tx + ty * ty + tz * tz, s = 2 / (1 + t2);
    const px = ux + (uy * tz - uz * ty), py = uy + (uz * tx - ux * tz), pz = uz + (ux * ty - uy * tx);
    ux += s * (py * tz - pz * ty); uy += s * (pz * tx - px * tz); uz += s * (px * ty - py * tx);
    const g2 = Math.sqrt(1 + (ux * ux + uy * uy + uz * uz) / (C0 * C0));
    const nx = xm + (ux / g2) * dt / 2, ny = ym + (uy / g2) * dt / 2, nz = zm + (uz / g2) * dt / 2;
    if (ny > start[1] + 0.005) top = true;
    if (top && hitX == null && y >= start[1] && ny < start[1]) { const t = (y - start[1]) / (y - ny); hitX = x + (nx - x) * t; hitAt = pts.length; }
    x = nx; y = ny; z = nz; pts.push([x, y, z]);
    if (bulb && Math.hypot(x - bulb.c[0], y - bulb.c[1], z - bulb.c[2]) > bulb.r) { end = 'glass'; break; }
    if (top && hitX != null && Math.hypot(x - start[0], y - start[1]) < 0.004) { end = 'gun'; break; }
  }
  return { pts, hitX, hitAt, end, v0, Tc };
}

/** 亥姆霍兹线圈中心的磁感应强度（教材公式）：B = (4/5)^{3/2} μ0 N I / R */
export const helmholtzB0 = (N, I, R) => Math.pow(0.8, 1.5) * 4e-7 * Math.PI * N * I / R;
