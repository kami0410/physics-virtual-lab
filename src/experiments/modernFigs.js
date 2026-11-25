// 近代物理实验原理页的示意图（SVG）
import { Fig, C } from '../core/diagram.js';

// ======================= 弗兰克-赫兹管 =======================
export function franckHertzFig() {
  const g = new Fig(290, 176);
  const yT = 20, yB = 78, xs = { K: 40, G1: 70, G2: 200, A: 240 };
  g.rect(24, yT - 6, 236, yB - yT + 12, { c: C.ink2, sw: 1 });
  g.line(xs.K, yT + 8, xs.K, yB - 8, { w: 3 }).text(xs.K, yB + 16, 'K', { size: 10 });
  g.line(xs.G1, yT, xs.G1, yB, { w: 1.2, dash: '3 2' }).text(xs.G1, yB + 16, 'G₁', { size: 10 });
  g.line(xs.G2, yT, xs.G2, yB, { w: 1.2, dash: '3 2' }).text(xs.G2, yB + 16, 'G₂', { size: 10 });
  g.line(xs.A, yT + 4, xs.A, yB - 4, { w: 3 }).text(xs.A, yB + 16, 'A', { size: 10 });
  g.line(xs.K + 6, (yT + yB) / 2, xs.G2 - 6, (yT + yB) / 2, { c: C.laser, w: 1 }).head(xs.G2 - 6, (yT + yB) / 2, 0, { c: C.laser, s: 4.5 });
  g.text((xs.G1 + xs.G2) / 2, (yT + yB) / 2 - 6, '电子加速，与氩原子碰撞', { size: 9, c: C.laser });
  // 电位分布
  const y0 = 160, k = 0.55;
  const P = [[xs.K, y0], [xs.G1, y0 - 8], [xs.G2, y0 - 60], [xs.A, y0 - 60 + 14]];
  g.line(24, y0, 270, y0, { c: C.ink3, w: 0.6 }).poly(P, { c: '#2f6f9f', w: 1.6 });
  g.text(xs.G1 + 4, y0 - 12, '*U*_{G1K}', { size: 9, a: 'start' });
  g.text(xs.G2 - 4, y0 - 64, '*U*_{G2K}', { size: 9, a: 'end' });
  g.text(xs.A + 4, y0 - 44, '−*U*_{G2A}', { size: 9, a: 'start' });
  g.text(30, y0 - 66, '电位', { size: 9, a: 'start', c: C.ink2 });
  void k;
  return g.html('图 1　充氩四极管与管内电位分布。电子在 G₁–G₂ 间加速，G₂–A 间的拒斥电压只让能量足够的电子到达板极');
}

// ======================= 电子荷质比：精细射束管中的圆形轨道 =======================
export function emFig() {
  const g = new Fig(280, 200);
  const cx = 130, cy = 100, Rb = 80, gx = 170, gy = 140, r = 40;
  g.circle(cx, cy, Rb, { c: C.ink3, w: 1, fill: '#f4f7f5' });
  for (let x = 82; x <= 178; x += 16) for (let y = 30; y <= 170; y += 16) if (Math.hypot(x - cx, y - cy) < Rb - 8) g.text(x, y + 3, '⊙', { size: 8, c: C.ink3 });
  g.circle(gx - r, gy, r, { c: '#2f87b8', w: 1.6 });
  g.rect(gx - 4, gy, 8, 18, { fill: C.metal, c: C.ink });
  g.line(gx - 2 * r - 8, gy + 3, gx, gy + 3, { c: C.ink2, w: 0.8 });
  for (const k of [1, 2, 3]) g.line(gx - (k * 2 * r) / 3, gy - 1, gx - (k * 2 * r) / 3, gy + 6, { c: '#2f9e6b', w: 1.4 });
  g.arrow(gx, gy - 4, gx, gy - 28, { c: C.laser }); g.text(gx + 6, gy - 20, '*v*', { a: 'start', size: 11, c: C.laser });
  g.arrow(gx - 4, gy - 40 + 6, gx - 26, gy - 40 + 6, { c: C.laser }); g.text(gx - 16, gy - 42, '*F*', { size: 10, c: C.laser });
  g.dim(gx - 2 * r, gy + 24, gx, gy + 24, '*D* = 2*r*', { off: 9 });
  g.text(cx + Rb - 4, 26, '*B*（指向纸外）', { a: 'end', size: 10, c: C.ink2 });
  return g.html('电子从枪口竖直向上射出，在垂直纸面的磁场中作圆周运动，回到枪口高度时打在离枪口 D = 2r 的标记上', { max: 360 });
}
