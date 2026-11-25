// 第二批力学、热学、电磁学、近代物理实验原理页的示意图（SVG）。几何关系按公式算，小量按比例放大画出。
import { Fig, C } from '../core/diagram.js';

const D2R = Math.PI / 180;

// ======================= 单摆 =======================
export function pendulumFig() {
  const g = new Fig(260, 200);
  const ox = 110, oy = 22, L = 140, th = 14 * D2R;
  g.line(60, oy, 160, oy, { w: 2 });
  for (let x = 64; x < 160; x += 8) g.line(x, oy, x - 6, oy - 6, { w: 0.6, c: C.ink2 });
  g.line(ox, oy, ox, oy + L + 18, { c: C.ink3, w: 0.7, dash: '4 3' });
  const bx = ox + L * Math.sin(th), by = oy + L * Math.cos(th);
  g.line(ox, oy, bx, by, { w: 1.1 });
  g.circle(bx, by, 7, { fill: '#a4adb6', c: C.ink, w: 1 });
  g.circle(ox, oy + L, 7, { c: C.ink3, w: 0.8, fill: 'none' });
  g.arc(ox, oy, 36, 90 - 14, 90, '*θ*', { lr: 10 });
  g.dim(ox - 30, oy, ox - 30, oy + L, '*L*', { off: -9 });
  g.text(ox + 14, oy + L + 10, '*d*', { size: 10, c: C.ink2 });
  g.arrow(bx, by + 9, bx, by + 34, { c: C.laser });
  g.text(bx + 10, by + 30, '*mg*', { a: 'start', size: 10, c: C.laser });
  g.callout(ox + 2, oy + 2, ox + 46, oy + 12, '悬点', {});
  return g.html('单摆：L 为悬点到球心的距离 = 摆线长 l + 摆球半径 d/2', { max: 330 });
}

// ======================= 同轴电极的等势线与电场线 =======================
export function efieldFig() {
  const g = new Fig(250, 200), cx = 125, cy = 100, r1 = 10, r2 = 80;
  g.circle(cx, cy, r2, { c: C.ink, w: 3 });
  g.circle(cx, cy, r1, { fill: '#9aa5ab', c: C.ink, w: 1 });
  for (const U of [0.2, 0.4, 0.6, 0.8]) g.circle(cx, cy, r2 * Math.pow(r1 / r2, U), { c: C.lamp, w: 0.9, dash: '4 2' });
  for (let k = 0; k < 12; k++) { const a = (k * Math.PI) / 6, c = Math.cos(a), s = Math.sin(a); g.line(cx + (r1 + 1) * c, cy + (r1 + 1) * s, cx + (r2 - 1) * c, cy + (r2 - 1) * s, { c: C.laser, w: 0.7 }); g.head(cx + (r1 + 40) * c, cy + (r1 + 40) * s, a, { c: C.laser, s: 4 }); }
  g.dim(cx, cy, cx - r2 * 0.707, cy + r2 * 0.707, '', {});
  g.text(cx - 34, cy + 34, '*r*_{2}', { size: 11, bg: true });
  g.text(cx + 6, cy - 14, '*r*_{1}', { size: 10, bg: true });
  g.text(cx + r2 * 0.36 + 18, cy - r2 * 0.36 - 6, '等势线', { size: 10, c: C.lamp, bg: true });
  g.text(cx + 64, cy + 54, '电场线', { size: 10, c: C.laser, bg: true });
  return g.html('同轴电极：等势线是同心圆（虚线），电场线沿半径方向（红线）', { max: 320 });
}

// ======================= 密立根油滴：平衡与匀速下落 =======================
export function millikanFig() {
  const g = new Fig(300, 190);
  const x0 = 30, x1 = 150, yt = 30, yb = 150;
  for (const [y, s] of [[yt, '+'], [yb, '−']]) { g.rect(x0, y - 4, x1 - x0, 8, { fill: C.metal, c: C.ink }); g.text(x1 + 12, y + 4, s, { size: 13 }); }
  g.dim(x0 - 10, yt, x0 - 10, yb, '*d*', { off: -9 });
  const cx = 90, cy = 90;
  g.circle(cx, cy, 6, { fill: '#e6e9ee', c: C.ink });
  g.arrow(cx, cy - 8, cx, cy - 40, { c: C.laser }); g.text(cx + 8, cy - 32, '*qU*/*d*', { a: 'start', size: 10, c: C.laser });
  g.arrow(cx, cy + 8, cx, cy + 40, { c: C.ink }); g.text(cx + 8, cy + 38, '*mg*', { a: 'start', size: 10 });
  g.text(cx, yb + 26, '平衡：电压 U', { size: 10, c: C.ink2 });
  const X0 = 180, X1 = 280;
  for (const y of [yt, yb]) g.rect(X0, y - 4, X1 - X0, 8, { fill: C.metal, c: C.ink });
  const ex = 230, ya = 68, yb2 = 120;
  g.line(X0 + 8, ya, X1 - 8, ya, { c: C.lamp, w: 0.8, dash: '4 2' }); g.line(X0 + 8, yb2, X1 - 8, yb2, { c: C.lamp, w: 0.8, dash: '4 2' });
  g.dim(X1 - 4, ya, X1 - 4, yb2, '*l*', { off: 9 });
  g.circle(ex, 92, 6, { fill: '#e6e9ee', c: C.ink });
  g.arrow(ex, 84, ex, 64, { c: C.laser }); g.text(ex - 8, 68, '6π*ηav*', { a: 'end', size: 10, c: C.laser });
  g.arrow(ex, 100, ex, 124, { c: C.ink }); g.text(ex - 8, 120, '*mg*', { a: 'end', size: 10 });
  g.text(ex, yb + 26, 'U = 0：匀速下落 l 用时 t_{g}', { size: 10, c: C.ink2 });
  return g.html('左：电场力与重力平衡；右：撤去电压，重力与黏滞阻力平衡，油滴匀速下落', { max: 380 });
}

// ======================= 弦线驻波 =======================
export function stringFig() {
  const g = new Fig(320, 150);
  const x0 = 30, x1 = 250, y = 70, A = 26, n = 3;
  const pts = (s) => Array.from({ length: 121 }, (_, i) => [x0 + ((x1 - x0) * i) / 120, y - s * A * Math.sin((n * Math.PI * i) / 120)]);
  g.poly(pts(1), { c: C.ink, w: 1.1 }); g.poly(pts(-1), { c: C.ink3, w: 0.8, dash: '3 2' });
  g.line(x0, y, x1, y, { c: C.ink3, w: 0.6 });
  for (const x of [x0, x1]) g.poly([[x, y], [x - 6, y + 12], [x + 6, y + 12]], { close: true, fill: C.metal, c: C.ink });
  g.text(x0, y + 24, 'A', { size: 10 }); g.text(x1, y + 24, 'B', { size: 10 });
  g.rect(x0 + 10, y + 6, 6, 8, { fill: C.laser, c: C.laser });
  g.dim(x0, y - 40, x0 + (x1 - x0) / 3, y - 40, '*λ*/2', { off: -6 });
  g.dim(x0, y + 40, x1, y + 40, '*L*', { off: 9 });
  g.text((x0 + x1) / 2 - 36, y - 4, '波节', { size: 9, c: C.ink2, bg: true });
  g.circle(286, y + 22, 9, { c: C.ink, fill: C.metal });
  g.line(x1, y, 286, y + 13, { w: 0.8 }); g.line(295, y + 22, 295, y + 52, { w: 0.8 });
  g.rect(288, y + 52, 14, 14, { fill: C.metal, c: C.ink }); g.text(310, y + 63, '*m*', { a: 'start', size: 10 });
  return g.html('弦长 L 为半波长的整数倍时形成稳定驻波（图为 n = 3）；张力 T = mg 由砝码提供', { max: 420 });
}

// ======================= 比热容比：三个状态的 p–V（以瓶内剩余气体为研究对象） =======================
export function gammaFig() {
  const g = new Fig(280, 190);
  const X = (v) => 50 + v * 190, Y = (p) => 160 - p * 130;
  g.arrow(40, 165, 260, 165, { c: C.ink2 }); g.arrow(45, 170, 45, 18, { c: C.ink2 });
  g.text(255, 180, '*V*', { size: 11 }); g.text(34, 24, '*p*', { size: 11 });
  const gam = 1.4, v1 = 0.25, p1 = 0.95, p0 = 0.3, v2 = v1 * Math.pow(p1 / p0, 1 / gam);
  const ad = Array.from({ length: 31 }, (_, i) => { const v = v1 + ((v2 - v1) * i) / 30; return [X(v), Y(p1 * Math.pow(v1 / v, gam))]; });
  const iso = Array.from({ length: 31 }, (_, i) => { const v = v1 + ((v2 * 1.15 - v1) * i) / 30; return [X(v), Y((p1 * v1) / v)]; });
  g.poly(iso, { c: C.ink3, w: 0.8, dash: '4 3' });
  g.poly(ad, { c: C.laser, w: 1.3 });
  g.line(X(v2), Y(p0), X(v2), Y((p1 * v1) / v2), { c: C.lamp, w: 1.3 });
  g.dot(X(v1), Y(p1), 3); g.dot(X(v2), Y(p0), 3); g.dot(X(v2), Y(p1 * v1 / v2), 3);
  g.text(X(v1) - 8, Y(p1) - 6, 'Ⅰ (*p*_{1}, *T*_{0})', { a: 'start', size: 10 });
  g.text(X(v2) + 6, Y(p0) + 4, 'Ⅱ (*p*_{0}, *T*_{1})', { a: 'start', size: 10 });
  g.text(X(v2) + 6, Y(p1 * v1 / v2) - 2, 'Ⅲ (*p*_{2}, *T*_{0})', { a: 'start', size: 10 });
  g.text(X(0.5), Y(0.62), '绝热', { size: 10, c: C.laser, bg: true });
  g.text(X(0.62) + 40, Y(0.5) - 6, '等温线', { size: 9, c: C.ink3 });
  return g.html('Ⅰ→Ⅱ 绝热膨胀（红），Ⅱ→Ⅲ 等容吸热（橙）；Ⅰ、Ⅲ 温度相同，在同一条等温线上', { max: 380 });
}

// ======================= 线膨胀：加热管与千分表 =======================
export function expansionFig() {
  const g = new Fig(300, 130);
  g.rect(40, 40, 180, 40, { fill: '#f3e4df', c: C.ink2 });
  g.rect(20, 56, 210, 8, { fill: C.metal, c: C.ink });
  g.rect(14, 44, 6, 32, { fill: C.ink2, c: C.ink });
  g.rect(230, 56, 6, 8, { fill: C.metal, c: C.laser });
  g.line(236, 60, 250, 60, { w: 1.4 });
  g.circle(266, 60, 16, { fill: '#f4f1e6', c: C.ink });
  g.line(266, 60, 274, 50, { c: C.laser, w: 1.4 });
  g.dim(20, 96, 230, 96, '*L*_{0}', { off: 9 });
  g.dim(230, 30, 236, 30, 'Δ*L*', { off: -6 });
  g.text(130, 36, '电加热管', { size: 10, c: C.ink2 });
  g.text(266, 92, '千分表', { size: 10, c: C.ink2 });
  return g.html('金属棒一端顶住固定端，受热伸长 ΔL 推动千分表测杆', { max: 400 });
}

// ======================= 拉脱法表面张力 =======================
export function surfaceFig() {
  const g = new Fig(300, 150);
  const yS = 112, yR = 72, xl = 90, xr = 210;
  g.rect(10, yS, 280, 30, { fill: '#dcebf2', c: 'none' });
  g.line(10, yS, 290, yS, { c: C.ink2 });
  // 吊环截面（左右两个壁）与两侧的液膜
  for (const x of [xl, xr]) {
    g.path(`M${x - 3} ${yR} C${x - 4} ${yS - 12} ${x - 14} ${yS - 2} ${x - 30} ${yS} L${x + 30} ${yS} C${x + 14} ${yS - 2} ${x + 4} ${yS - 12} ${x + 3} ${yR} Z`, { fill: '#b9d7e6', c: C.ink3, w: 0.6 });
    g.rect(x - 3, yR - 18, 6, 18, { fill: C.metal, c: C.ink });
    g.line(x - 3, yR + 4, x - 3, yR - 6, { c: C.laser, w: 1.4 });
    g.line(x + 3, yR + 4, x + 3, yR - 6, { c: C.laser, w: 1.4 });
  }
  g.line(150, 14, xl, yR - 18, { c: C.ink2, w: 0.8 });
  g.line(150, 14, xr, yR - 18, { c: C.ink2, w: 0.8 });
  g.dim(xl - 3, 40, xr + 3, 40, '*D*_{2}', { off: -6 });
  g.dim(xl + 3, 56, xr - 3, 56, '*D*_{1}', { off: -6 });
  g.text(250, 104, '水', { size: 10, c: C.ink2 });
  g.text(46, 92, '液膜', { size: 10, c: C.ink2 });
  return g.html('液膜内外两层表面沿吊环内、外圆周向下拉住吊环（红线示拉力方向）', { max: 400 });
}

// ======================= 气垫导轨碰撞 =======================
export function airtrackFig() {
  const g = new Fig(320, 130);
  const y = 84;
  g.rect(10, y, 300, 10, { fill: '#d5dbe1', c: C.ink2 });
  for (let x = 18; x < 305; x += 9) g.circle(x, y + 5, 1.2, { fill: C.ink3, c: 'none' });
  const glider = (x, lab) => { g.path(`M${x - 34} ${y} L${x - 28} ${y - 16} L${x + 28} ${y - 16} L${x + 34} ${y} Z`, { fill: '#e6e2d8', c: C.ink }); g.rect(x - 3, y - 34, 6, 18, { fill: C.ink2, c: C.ink }); g.text(x, y - 4, lab, { size: 10, i: true }); };
  glider(70, 'm₁'); glider(180, 'm₂');
  g.circle(107, y - 8, 3, { c: C.ink2 });
  for (const [x, t] of [[120, '光电门 1'], [262, '光电门 2']]) { g.line(x, y - 44, x, y - 20, { c: C.laser, w: 1, dash: '3 2' }); g.rect(x - 4, y - 50, 8, 6, { fill: C.ink2, c: C.ink }); g.text(x, y - 56, t, { size: 10, c: C.ink2 }); }
  g.line(70, y - 44, 98, y - 44, { w: 1.2 }); g.path(`M98 ${y - 44} l-5 -3 v6 z`, { fill: C.ink, c: 'none' }); g.text(84, y - 48, '*v*_{10}', { size: 10 });
  g.text(180, y - 40, '*v*_{20} = 0', { size: 10 });
  g.dim(67, y + 22, 73, y + 22, 'Δ*x*', { off: 8 });
  return g.html('滑块 1 过光电门 1 后撞上静止的滑块 2，碰后两滑块通过光电门 2', { max: 420 });
}
