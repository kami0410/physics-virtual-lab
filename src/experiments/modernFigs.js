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

// ======================= PN 结伏安特性：运放电流–电压变换 =======================
export function pnFig() {
  const g = new Fig(300, 170);
  const yIn = 70, xA = 170; // 运放反相输入端
  // 可调电压 U1（电位器）
  g.circle(36, 110, 14, { c: C.ink }).text(36, 114, 'U₁', { size: 10 });
  g.line(36, 96, 36, yIn).line(36, yIn, 80, yIn);
  // PN 结（二极管符号，正向朝右）
  g.poly([[80, yIn - 9], [80, yIn + 9], [98, yIn]], { close: true, fill: C.paper });
  g.line(98, yIn - 9, 98, yIn + 9, { w: 1.6 }).line(98, yIn, xA - 18, yIn);
  g.text(89, yIn - 15, 'PN 结', { size: 9, c: C.ink2 });
  g.arrow(112, yIn - 7, 140, yIn - 7, { c: C.laser }); g.text(126, yIn - 12, '*I*', { size: 10, c: C.laser });
  // 运放三角形
  g.poly([[xA - 18, yIn - 22], [xA - 18, yIn + 42], [xA + 32, yIn + 10]], { close: true, fill: '#fff' });
  g.text(xA - 11, yIn + 4, '−', { size: 12 }).text(xA - 11, yIn + 34, '+', { size: 12 });
  g.line(xA - 30, yIn + 30, xA - 18, yIn + 30).line(xA - 30, yIn + 30, xA - 30, 150).line(36, 124, 36, 150).line(36, 150, 280, 150, { c: C.ink2 });
  // 反馈电阻 Rf
  g.line(xA - 24, yIn, xA - 24, 28).line(xA - 24, 28, xA + 4, 28);
  g.rect(xA + 4, 22, 30, 12, { fill: '#fff' }).text(xA + 19, 16, '*R*_{f}', { size: 10 });
  g.line(xA + 34, 28, 262, 28).line(262, 28, 262, yIn + 10).line(xA + 32, yIn + 10, 262, yIn + 10);
  g.line(262, yIn + 10, 262, 108, { dash: '3 2', c: C.ink3 }).text(270, 104, '*U*_{2}', { size: 10, a: 'start' });
  g.text(xA - 24, yIn + 56, '虚地', { size: 9, c: C.ink3 });
  return g.html('图 1　电流–电压变换器：反相输入端虚地，PN 结两端电压为 U₁，电流全部流过 R_f，输出 U₂ = I·R_f');
}

// ======================= 塞曼效应：汞 546.1 nm 的能级分裂与 9 条谱线 =======================
export function zeemanFig() {
  const g = new Fig(320, 230);
  // 上能级 7³S₁（g = 2）：M = 1, 0, −1；下能级 6³P₂（g = 3/2）：M = 2…−2。能级间隔按 Mg 成比例画
  const xL = 30, xR = 300, yU = 46, yD = 128, su = 9, sd = 6.75;
  g.line(xL, yU, 96, yU, { w: 1.4 }).text(xL, yU - 8, '7³S₁', { size: 10, a: 'start' });
  g.line(xL, yD, 96, yD, { w: 1.4 }).text(xL, yD + 16, '6³P₂', { size: 10, a: 'start' });
  g.text(63, (yU + yD) / 2 + 4, 'B = 0', { size: 9, c: C.ink3 });
  const up = [1, 0, -1].map((M) => [M, yU - M * 2 * su]), dn = [2, 1, 0, -1, -2].map((M) => [M, yD - M * 1.5 * sd]);
  for (const [M, y] of up) { g.line(120, y, xR, y, { w: 1 }); g.text(xR + 4, y + 3, `${M > 0 ? '+' : ''}${M}`, { size: 8.5, a: 'start', c: C.ink2 }); }
  for (const [M, y] of dn) { g.line(120, y, xR, y, { w: 1 }); g.text(xR + 4, y + 3, `${M > 0 ? '+' : ''}${M}`, { size: 8.5, a: 'start', c: C.ink2 }); }
  g.text(xR + 4, yU - 30, '*M*', { size: 9, a: 'start' });
  g.line(96, yU, 120, up[0][1], { c: C.ink3, w: 0.6, dash: '2 2' }).line(96, yU, 120, up[2][1], { c: C.ink3, w: 0.6, dash: '2 2' });
  g.line(96, yD, 120, dn[0][1], { c: C.ink3, w: 0.6, dash: '2 2' }).line(96, yD, 120, dn[4][1], { c: C.ink3, w: 0.6, dash: '2 2' });
  // 9 条跃迁：π 竖直，σ 斜线；对应下方的谱线位置
  const trs = [];
  for (const [Mu, yu] of up) for (const [Md, yd] of dn) if (Math.abs(Mu - Md) <= 1) trs.push({ Mu, Md, yu, yd, s: Mu * 2 - Md * 1.5 });
  trs.sort((a, b) => a.s - b.s);
  const yS = 206, x0 = 210, kx = 28;
  trs.forEach((t, i) => {
    const xa = 132 + i * 18, pi = t.Mu === t.Md, c = pi ? C.laser : '#2f6f9f';
    g.arrow(xa, t.yu, xa, t.yd, { c, w: pi ? 1.2 : 0.9 });
    const xs = x0 + t.s * kx, h = 6.5 * (pi ? 4 - t.Mu * t.Mu : { 1: 3, 1.5: 1.5, 2: 0.5 }[Math.abs(t.s)]); // 相对强度
    g.line(xs, yS, xs, yS - h, { c, w: 2 });
  });
  g.line(x0 - 2.3 * kx, yS, x0 + 2.3 * kx, yS, { c: C.ink2, w: 0.8 });
  for (const s of [-2, -1, 0, 1, 2]) g.text(x0 + s * kx, yS + 12, s ? `${s > 0 ? '+' : '−'}${Math.abs(s)}` : '0', { size: 8.5, c: C.ink2 });
  g.text(x0 + 2.4 * kx, yS + 12, '*L*', { size: 9, a: 'start' });
  g.text(30, yS - 8, 'π（红）：Δ*M* = 0', { size: 9, a: 'start', c: C.laser });
  g.text(30, yS + 8, 'σ（蓝）：Δ*M* = ±1', { size: 9, a: 'start', c: '#2f6f9f' });
  return g.html('图 1　汞 546.1 nm 谱线的反常塞曼分裂：上能级分 3 个、下能级分 5 个子能级，9 条跃迁对应下方 9 条谱线（位置以洛伦兹单位 L 计，竖线长短表示强度）');
}
