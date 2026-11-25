// 电磁学实验原理页的电路图与示意图（坐标为 SVG 用户单位，宽约 280）
// 电路符号按国家标准的画法：电阻为矩形框、电池长线为正极、电表为圆圈内写字母。
import { Fig, C } from '../core/diagram.js';

// ---------------- 电路符号 ----------------
/** 导线折线 */
const wire = (g, pts, o = {}) => g.poly(pts, { w: 1.1, ...o });
/** 电阻（矩形框），沿 (x1,y1)→(x2,y2) 的水平或竖直导线居中放置；var 为真时画可调箭头 */
function res(g, x1, y1, x2, y2, label = '', { len = 24, wd = 8, vari = false, lx = 0, ly = 0 } = {}) {
  const hz = y1 === y2, cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  if (hz) { g.line(x1, y1, cx - len / 2, y1, { w: 1.1 }).line(cx + len / 2, y1, x2, y2, { w: 1.1 }); g.rect(cx - len / 2, cy - wd / 2, len, wd, { sw: 1.1, fill: '#fff' }); }
  else { g.line(x1, y1, x1, cy - len / 2, { w: 1.1 }).line(x1, cy + len / 2, x2, y2, { w: 1.1 }); g.rect(cx - wd / 2, cy - len / 2, wd, len, { sw: 1.1, fill: '#fff' }); }
  if (vari) g.arrow(cx - 11, cy + 9, cx + 11, cy - 9, { c: C.ink, w: 0.9, s: 4 });
  if (label) g.text(cx + (hz ? 0 : 13) + lx, cy + (hz ? -9 : 4) + ly, label, { size: 10, a: hz ? 'middle' : 'start' });
  return g;
}
/** 电池：plus 为长线一侧（'l' 左/上，'r' 右/下） */
function cell(g, x1, y1, x2, y2, label = '', { plus = 'l', lx = 0, ly = 0 } = {}) {
  const hz = y1 === y2, cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, d = 3;
  const a = plus === 'l' ? -d : d;
  if (hz) {
    g.line(x1, y1, cx - d, y1, { w: 1.1 }).line(cx + d, y1, x2, y2, { w: 1.1 });
    g.line(cx + a, cy - 9, cx + a, cy + 9, { w: 1.2 }).line(cx - a, cy - 4.5, cx - a, cy + 4.5, { w: 2.6 });
    if (label) g.text(cx + lx, cy - 13 + ly, label, { size: 10 });
  } else {
    g.line(x1, y1, x1, cy - d, { w: 1.1 }).line(x1, cy + d, x2, y2, { w: 1.1 });
    g.line(cx - 9, cy + a, cx + 9, cy + a, { w: 1.2 }).line(cx - 4.5, cy - a, cx + 4.5, cy - a, { w: 2.6 });
    if (label) g.text(cx + 14 + lx, cy + 4 + ly, label, { size: 10, a: 'start' });
  }
  return g;
}
/** 电表（圆圈中写字母） */
function meter(g, x, y, s, r = 8.5) { g.circle(x, y, r, { w: 1.1, fill: '#fff' }); return g.text(x, y + 3.6, s, { size: 10, i: true }); }
/** 单刀开关（水平），open 为真时刀片抬起 */
function sw(g, x1, y, x2, label = '', open = true) {
  g.dot(x1, y, 1.8).dot(x2, y, 1.8);
  g.line(x1, y, x2 - 2, open ? y - 8 : y, { w: 1.2 });
  if (label) g.text((x1 + x2) / 2, y + 13, label, { size: 10 });
  return g;
}

// ======================= 十一线电位差计 =======================
export function potentiometerFig() {
  const g = new Fig(280, 176), y = 64;
  // 电阻丝 AB
  g.line(30, y, 250, y, { c: C.ink, w: 2.4 });
  g.text(24, y + 4, 'A', { size: 11, a: 'end' }).text(256, y + 4, 'B', { size: 11, a: 'start' });
  // 工作回路
  wire(g, [[30, y], [30, 22], [64, 22]]); cell(g, 64, 22, 94, 22, '*E*', { plus: 'l' });
  wire(g, [[94, 22], [122, 22]]); sw(g, 122, 22, 146, ''); g.text(134, 12, 'K₁', { size: 10 });
  res(g, 146, 22, 206, 22, '*R*ₚ', { vari: true, ly: -1 });
  wire(g, [[206, 22], [250, 22], [250, y]]);
  g.arrow(120, y - 9, 150, y - 9, { c: C.laser, w: 0.9, s: 4.5 }); g.text(135, y - 14, '*I*₀', { size: 10, c: C.laser });
  // C、D
  const xc = 70, xd = 214;
  g.dot(xc, y, 2.4); g.text(xc - 6, y - 7, 'C', { size: 11 });
  g.path(`M${xd},${y + 1.5}L${xd - 4},${y + 8}L${xd + 4},${y + 8}Z`, { fill: C.ink }); g.text(xd + 8, y - 6, 'D', { size: 11 });
  g.dim(xc, y + 6, xd, y + 6, '*L*', { off: 10, c: C.ink2 });
  // 补偿回路
  const ys = 104, yx = 142, xk = 150;
  wire(g, [[xc, y], [xc, yx]]); g.dot(xc, ys, 1.8);
  wire(g, [[xc, ys], [92, ys]]); cell(g, 92, ys, 112, ys, '*E*ₛ', { plus: 'l' }); wire(g, [[112, ys], [xk - 6, ys]]);
  wire(g, [[xc, yx], [92, yx]]); cell(g, 92, yx, 112, yx, '*E*ₓ', { plus: 'l' }); wire(g, [[112, yx], [xk - 6, yx]]);
  g.dot(xk - 6, ys, 1.8).dot(xk - 6, yx, 1.8);
  const pv = [xk + 14, (ys + yx) / 2];
  g.dot(pv[0], pv[1], 1.8); g.line(pv[0], pv[1], xk - 4, ys + 3, { w: 1.2 }); g.text(xk + 4, yx + 15, 'K₂', { size: 10 });
  wire(g, [[pv[0], pv[1]], [178, pv[1]]]); meter(g, 187, pv[1], 'G'); res(g, 196, pv[1], 236, pv[1], '保护电阻', { len: 20, ly: 22 });
  wire(g, [[236, pv[1]], [244, pv[1]], [244, 92], [xd, 92], [xd, y + 8]]);
  return g.html('图 1　十一线电位差计：上为工作回路，下为补偿回路。平衡时 <i>E</i><sub>x</sub> = <i>U</i><sub>0</sub><i>L</i>');
}

// ======================= 霍尔效应 =======================
export function hallFig() {
  const g = new Fig(280, 170);
  // 斜视的薄片：x 向右，y 向后上，z 向上
  const P = (x, y, z) => [70 + x + 0.55 * y, 112 - z - 0.35 * y];
  const L = 130, Wd = 60, T = 10;
  const q = (pts) => pts.map((p) => P(...p));
  g.poly(q([[0, 0, T], [L, 0, T], [L, Wd, T], [0, Wd, T]]), { close: true, fill: '#cfe0d2', c: C.ink, w: 1 });
  g.poly(q([[0, 0, 0], [L, 0, 0], [L, 0, T], [0, 0, T]]), { close: true, fill: '#a9c4ae', c: C.ink, w: 1 });
  g.poly(q([[L, 0, 0], [L, Wd, 0], [L, Wd, T], [L, 0, T]]), { close: true, fill: '#b8cfbc', c: C.ink, w: 1 });
  // 电流 Is
  const [ax, ay] = P(-34, Wd / 2, T / 2), [bx, by] = P(0, Wd / 2, T / 2);
  g.arrow(ax, ay, bx, by, { c: C.laser, w: 1.4, s: 5.5 }); g.text(ax - 2, ay - 6, '*I*ₛ', { size: 11, c: C.laser });
  const [cx2, cy2] = P(L, Wd / 2, T / 2), [dx2, dy2] = P(L + 30, Wd / 2, T / 2);
  g.arrow(cx2, cy2, dx2, dy2, { c: C.laser, w: 1.4, s: 5.5 });
  // 磁场 B 向上
  for (const [x, y] of [[30, 18], [100, 18], [30, 46], [100, 46]]) { const [p1, p2] = [P(x, y, T + 4), P(x, y, T + 40)]; g.arrow(p1[0], p1[1], p2[0], p2[1], { c: '#1d4ed8', w: 1.1, s: 5 }); }
  const [bl] = [P(108, 46, T + 44)]; g.text(bl[0] + 6, bl[1], '*B*', { size: 11, c: '#1d4ed8', a: 'start' });
  // 两侧电极与 V_H
  const [e1x, e1y] = P(L / 2, 0, T / 2), [e2x, e2y] = P(L / 2, Wd, T / 2);
  g.dot(e1x, e1y, 2.6).dot(e2x, e2y, 2.6);
  g.text(e1x, e1y + 14, 'A', { size: 10.5 }).text(e2x - 7, e2y - 4, 'A′', { size: 10.5, a: 'end' });
  // 尺寸
  const [h1x, h1y] = P(0, 0, 0), [h2x, h2y] = P(0, 0, T);
  g.line(h1x - 6, h1y, h1x - 14, h1y, { c: C.ink3, w: 0.6 }).line(h2x - 6, h2y, h2x - 14, h2y, { c: C.ink3, w: 0.6 }); g.text(h1x - 18, (h1y + h2y) / 2 + 4, '*d*', { size: 10, a: 'end', c: C.ink2 });
  const [w2x, w2y] = P(L, Wd * 0.25, 0); g.text(w2x + 9, w2y + 12, '*b*', { size: 10, c: C.ink2, a: 'start' });
  // 洛伦兹力（以 N 型为例：电子向 −x 运动，力指向 −y，即 A 侧）
  g.text(196, 158, 'N 型：电子偏向 A 侧，A 端电位较低', { size: 9.5, c: C.ink2 });
  // 坐标
  const o = [24, 150];
  g.arrow(o[0], o[1], o[0] + 22, o[1], { c: C.ink3, w: 0.8, s: 4 }).text(o[0] + 26, o[1] + 4, 'x', { size: 9.5, a: 'start', c: C.ink3, i: true });
  g.arrow(o[0], o[1], o[0], o[1] - 22, { c: C.ink3, w: 0.8, s: 4 }).text(o[0] - 5, o[1] - 24, 'z', { size: 9.5, c: C.ink3, i: true });
  g.arrow(o[0], o[1], o[0] + 12, o[1] - 8, { c: C.ink3, w: 0.8, s: 4 }).text(o[0] + 16, o[1] - 10, 'y', { size: 9.5, a: 'start', c: C.ink3, i: true });
  return g.html('图 1　霍尔元件：电流沿 x、磁场沿 z，霍尔电压出现在 y 方向的两个电极 A、A′ 之间');
}

// ======================= 圆线圈、亥姆霍兹线圈 =======================
export function helmholtzFig(B) {
  // B(k, x)：k = 间距/半径，x 以半径为单位，返回相对于单线圈中心场的轴线磁场
  const g = new Fig(280, 176);
  const xa = 34, x0 = 156, y0 = 152, sx = 44, sy = 68;
  g.line(xa, y0, 272, y0, { c: C.ink3, w: 0.8 }); g.line(xa, y0, xa, 16, { c: C.ink3, w: 0.8 });
  g.line(x0, y0, x0, 24, { c: C.ink3, w: 0.6, dash: '3 3' });
  g.text(278, y0 + 15, '*x*/*R*', { size: 10, a: 'end' }).text(xa + 4, 14, '*B*/*B*₀', { size: 10, a: 'start' });
  for (const t of [-2, -1, 0, 1, 2]) { g.line(x0 + t * sx, y0, x0 + t * sx, y0 + 4, { c: C.ink3, w: 0.8 }); g.text(x0 + t * sx, y0 + 15, String(t), { size: 9.5, c: C.ink2 }); }
  for (const v of [0.5, 1, 1.5]) { g.line(xa - 4, y0 - v * sy, xa, y0 - v * sy, { c: C.ink3, w: 0.8 }); g.text(xa - 6, y0 - v * sy + 4, String(v), { size: 9.5, a: 'end', c: C.ink2 }); }
  const curve = (k, c, dash = '') => { const pts = []; for (let i = 0; i <= 160; i++) { const x = -2.6 + (5.2 * i) / 160; pts.push([x0 + x * sx, y0 - B(k, x) * sy]); } g.poly(pts, { c, w: 1.3, dash }); };
  curve(0, C.ink3, '4 3');
  curve(0.5, '#0f766e'); curve(1, C.laser); curve(2, '#1d4ed8');
  g.text(x0 + 0.62 * sx, y0 - 1.72 * sy, '*d* = *R*/2', { size: 9.5, c: '#0f766e', a: 'start' });
  g.text(x0 + 0.95 * sx, y0 - 1.36 * sy, '*d* = *R*', { size: 9.5, c: C.laser, a: 'start' });
  g.text(x0 + 1.62 * sx, y0 - 0.98 * sy, '*d* = 2*R*', { size: 9.5, c: '#1d4ed8', a: 'start' });
  g.line(xa + 10, 30, xa + 30, 30, { c: C.ink3, w: 1.3, dash: '4 3' }).text(xa + 34, 34, '单个线圈', { size: 9.5, c: C.ink2, a: 'start' });
  return g.html('图 1　两线圈同向串联时轴线上的磁场（以单线圈中心磁场 <i>B</i><sub>0</sub> 为单位，原点在两线圈正中）');
}

// ======================= 磁滞回线 =======================
export function hysteresisFig() {
  const g = new Fig(280, 160);
  // 环形样品
  const cx = 140, cy = 70;
  g.circle(cx, cy, 30, { c: C.ink, w: 7, fill: 'none' });
  g.circle(cx, cy, 30, { c: '#555', w: 5, fill: 'none' });
  for (let i = 0; i < 9; i++) { const a = Math.PI * (0.62 + (i / 8) * 0.76); g.line(cx + Math.cos(a) * 23, cy + Math.sin(a) * 23, cx + Math.cos(a) * 37, cy + Math.sin(a) * 37, { c: '#b86b2b', w: 1.3 }); }
  for (let i = 0; i < 9; i++) { const a = Math.PI * (-0.38 + (i / 8) * 0.76); g.line(cx + Math.cos(a) * 23, cy + Math.sin(a) * 23, cx + Math.cos(a) * 37, cy + Math.sin(a) * 37, { c: '#b86b2b', w: 1.3 }); }
  g.text(cx - 46, cy - 34, '*N*₁', { size: 10 }).text(cx + 46, cy - 34, '*N*₂', { size: 10 });
  // 初级：~u — R1 — N1
  const yt = cy - 30, yb = cy + 30;
  wire(g, [[cx - 37, cy - 12], [72, cy - 12], [72, yt], [30, yt], [30, cy - 10]]);
  g.circle(30, cy, 10, { w: 1.1, fill: '#fff' }); g.text(30, cy + 4, '~', { size: 13 });
  wire(g, [[30, cy + 10], [30, yb + 26], [48, yb + 26]]); res(g, 48, yb + 26, 92, yb + 26, '*R*₁', { ly: 0 }); wire(g, [[92, yb + 26], [102, yb + 26], [102, cy + 12], [cx - 37, cy + 12]]);
  g.text(16, cy + 4, '*u*', { size: 10, a: 'end' });
  g.dot(48, yb + 26, 1.8).dot(92, yb + 26, 1.8);
  g.text(70, yb + 44, '→ X（∝ *H*）', { size: 9.5, c: C.ink2 });
  // 次级：N2 — R2 — C
  wire(g, [[cx + 37, cy - 12], [196, cy - 12]]); res(g, 196, cy - 12, 240, cy - 12, '*R*₂');
  wire(g, [[240, cy - 12], [256, cy - 12], [256, cy - 2]]);
  g.line(248, cy - 2, 264, cy - 2, { w: 1.6 }).line(248, cy + 4, 264, cy + 4, { w: 1.6 }); g.text(268, cy + 5, '*C*', { size: 10, a: 'start' });
  wire(g, [[256, cy + 4], [256, cy + 12], [cx + 37, cy + 12]]);
  g.text(232, yb + 30, '*C* 两端 → Y（∝ *B*）', { size: 9.5, c: C.ink2 });
  return g.html('图 1　测量电路：采样电阻 <i>R</i><sub>1</sub> 上的电压正比于 <i>H</i>，积分电容 <i>C</i> 上的电压正比于 <i>B</i>');
}

// ======================= 伏安法 =======================
export function voltampFig() {
  const g = new Fig(300, 150);
  const one = (o, inner, caption) => {
    const xl = o + 18, xr = o + 132, yt = 62, yb = 118, yv = 24;
    // 上：电流表 + 待测电阻；下：电源 + 开关
    wire(g, [[xl, yb], [xl, yt], [o + 36, yt]]); meter(g, o + 45, yt, 'A'); wire(g, [[o + 54, yt], [o + 66, yt]]);
    res(g, o + 66, yt, o + 116, yt, '*R*ₓ', { len: 22, ly: 20 }); wire(g, [[o + 116, yt], [xr, yt], [xr, yb]]);
    const n1 = inner ? o + 28 : o + 60, n2 = o + 122;
    g.dot(n1, yt, 1.9).dot(n2, yt, 1.9);
    wire(g, [[n1, yt], [n1, yv], [(n1 + n2) / 2 - 8.5, yv]]); meter(g, (n1 + n2) / 2, yv, 'V'); wire(g, [[(n1 + n2) / 2 + 8.5, yv], [n2, yv], [n2, yt]]);
    wire(g, [[xl, yb], [o + 52, yb]]); cell(g, o + 52, yb, o + 66, yb, '*E*', { plus: 'l' }); wire(g, [[o + 66, yb], [o + 88, yb]]);
    sw(g, o + 88, yb, o + 108, ''); g.text(o + 98, yb - 13, 'K', { size: 10 }); wire(g, [[o + 108, yb], [xr, yb]]);
    g.text(o + 75, 140, caption, { size: 10, c: C.ink2 });
  };
  one(0, false, '(a) 电流表外接');
  one(150, true, '(b) 电流表内接');
  return g.html('图 1　伏安法的两种接法。外接时电流表多测了电压表的电流，内接时电压表多测了电流表的压降');
}

// ======================= 惠斯通电桥 =======================
export function bridgeFig() {
  const g = new Fig(280, 170);
  const xa = 40, xc = 140, xb = 240, yt = 34, yd = 104, ys = 146, ym = (yt + yd) / 2;
  wire(g, [[xa, yt], [xa, ys]]); wire(g, [[xb, yt], [xb, ys]]);
  res(g, xa, yt, xc, yt, '*R*₁', { len: 26 }); res(g, xc, yt, xb, yt, '*R*₂', { len: 26 });
  res(g, xa, yd, xc, yd, '*R*ₓ', { len: 26, ly: 20 }); res(g, xc, yd, xb, yd, '*R*₀', { len: 26, vari: true, ly: 20 });
  g.dot(xa, yt, 2).dot(xa, yd, 2).dot(xb, yt, 2).dot(xb, yd, 2).dot(xc, yt, 2.2).dot(xc, yd, 2.2);
  g.text(xa - 9, ym + 4, 'A', { size: 11, a: 'end' }).text(xb + 9, ym + 4, 'B', { size: 11, a: 'start' });
  g.text(xc, yt - 12, 'C', { size: 11 }).text(xc + 8, yd + 13, 'D', { size: 11, a: 'start' });
  // 检流计（对角线 CD）
  wire(g, [[xc, yt], [xc, ym - 9]]); meter(g, xc, ym, 'G'); wire(g, [[xc, ym + 9], [xc, yd]]);
  // 电源（对角线 AB）
  wire(g, [[xa, ys], [118, ys]]); cell(g, 118, ys, 134, ys, '*E*', { plus: 'l' }); wire(g, [[134, ys], [160, ys]]);
  sw(g, 160, ys, 182, ''); g.text(171, ys - 13, 'K', { size: 10 }); wire(g, [[182, ys], [xb, ys]]);
  return g.html('图 1　惠斯通电桥。检流计无电流时 <i>R</i><sub>1</sub><i>R</i><sub>0</sub> = <i>R</i><sub>2</sub><i>R</i><sub>x</sub>');
}

// ======================= 电表改装 =======================
export function calibFig() {
  const g = new Fig(300, 122);
  const term = (x, y, s) => { g.circle(x, y, 3, { w: 1.1, fill: '#fff' }); g.text(x, y - 11, s, { size: 11 }); };
  const box = (x, y, w, h) => g.rect(x, y, w, h, { c: C.ink3, sw: 0.8 });
  // (a) 并联分流电阻 → 电流表
  const ym = 56, y1 = 34, y2 = 78;
  box(28, 16, 100, 80);
  term(12, ym, '+'); wire(g, [[15, ym], [40, ym]]); wire(g, [[40, y1], [40, y2]]); g.dot(40, ym, 1.9);
  wire(g, [[40, y1], [69.5, y1]]); meter(g, 78, y1, 'G'); wire(g, [[86.5, y1], [116, y1]]);
  res(g, 40, y2, 116, y2, '*R*ₛ', { len: 26, ly: 20 });
  wire(g, [[116, y1], [116, y2]]); g.dot(116, ym, 1.9); wire(g, [[116, ym], [141, ym]]); term(144, ym, '−');
  g.text(78, 114, '(a) 并联分流电阻 → 电流表', { size: 10, c: C.ink2 });
  // (b) 串联分压电阻 → 电压表
  box(178, 36, 104, 40);
  term(164, ym, '+'); wire(g, [[167, ym], [190.5, ym]]); meter(g, 199, ym, 'G'); wire(g, [[207.5, ym], [218, ym]]);
  res(g, 218, ym, 270, ym, '*R*ₘ', { len: 26 }); wire(g, [[270, ym], [290, ym]]); term(293, ym, '−');
  g.text(232, 114, '(b) 串联分压电阻 → 电压表', { size: 10, c: C.ink2 });
  return g.html('图 1　表头改装：框内整体作为新电表使用');
}

// ======================= RC、RLC 串联电路 =======================
/** 电感（水平）：四个半圆线圈 */
function ind(g, x1, y, x2, label = '') {
  const n = 4, r = 5, w = 2 * r * n, s = (x1 + x2 - w) / 2;
  g.line(x1, y, s, y, { w: 1.1 }).line(s + w, y, x2, y, { w: 1.1 });
  let d = `M${s},${y}`;
  for (let k = 0; k < n; k++) d += `a${r},${r} 0 0 1 ${2 * r},0`;
  g.path(d, { w: 1.2 });
  if (label) g.text((x1 + x2) / 2, y - 13, label, { size: 10 });
  return g;
}
/** 电容（竖直） */
function capV(g, x, y1, y2, label = '') {
  const cy = (y1 + y2) / 2, d = 3.5;
  g.line(x, y1, x, cy - d, { w: 1.1 }).line(x, cy + d, x, y2, { w: 1.1 });
  g.line(x - 10, cy - d, x + 10, cy - d, { w: 1.6 }).line(x - 10, cy + d, x + 10, cy + d, { w: 1.6 });
  if (label) g.text(x - 15, cy + 4, label, { size: 10, a: 'end' });
  return g;
}
export function rlcFig() {
  const g = new Fig(280, 150);
  const xl = 36, xr = 212, yt = 36, yb = 120, cy = (yt + yb) / 2;
  // 方波信号源
  g.circle(xl, cy, 13, { w: 1.1, fill: '#fff' });
  g.path(`M${xl - 7},${cy + 3}h4v-6h6v6h4`, { w: 1 });
  wire(g, [[xl, cy - 13], [xl, yt], [52, yt]]); wire(g, [[xl, cy + 13], [xl, yb], [xr, yb]]);
  g.text(xl - 18, cy + 4, '*u*', { size: 10.5, a: 'end' });
  res(g, 52, yt, 108, yt, '*R*', { len: 26, vari: true });
  ind(g, 108, yt, 168, '*L*');
  wire(g, [[168, yt], [xr, yt]]); capV(g, xr, yt, yb, '*C*');
  g.dot(xr, yt, 1.9).dot(xr, yb, 1.9);
  // 示波器接电容两端
  wire(g, [[xr, yt], [246, yt], [246, 62]]); wire(g, [[xr, yb], [246, yb], [246, 98]]);
  g.rect(232, 62, 28, 36, { sw: 1.1, fill: '#fff' }); g.text(246, 75, 'CH1', { size: 9 }).text(246, 88, '⊥', { size: 10 });
  g.text(124, 140, 'RC 电路：把 L 短接', { size: 9.5, c: C.ink2 });
  return g.html('图 1　方波激励的 RLC 串联电路，示波器观察电容电压 <i>u</i><sub>C</sub>');
}

// ======================= 示波管 =======================
export function oscilloscopeFig() {
  const g = new Fig(290, 156);
  const y = 70;
  // 管壳与荧光屏
  g.path(`M20,${y - 16}H150L250,${y - 58}V${y + 58}L150,${y + 16}H20Z`, { w: 1.1, fill: '#f5f6f4' });
  g.path(`M250,${y - 58}Q258,${y} 250,${y + 58}`, { w: 2.2, c: '#3f8f5a' });
  // 电子枪
  g.rect(26, y - 7, 26, 14, { sw: 1, fill: '#d9dcd6' }).rect(56, y - 9, 6, 18, { sw: 1, fill: '#d9dcd6' }).rect(66, y - 9, 6, 18, { sw: 1, fill: '#d9dcd6' });
  g.text(48, y + 28, '电子枪', { size: 9.5, c: C.ink2 });
  // Y 偏转板（上下两块）、X 偏转板（前后两块，斜画）
  g.rect(84, y - 13, 24, 3, { sw: 0.8, fill: '#9aa3ad' }).rect(84, y + 10, 24, 3, { sw: 0.8, fill: '#9aa3ad' });
  g.text(96, y - 23, 'Y', { size: 10 });
  g.path(`M121,${y - 11}l5,-5h16l-5,5Z`, { w: 0.8, fill: '#9aa3ad' }).path(`M121,${y + 1}l5,-5h16l-5,5Z`, { w: 0.8, fill: '#9aa3ad', op: 0.7 });
  g.text(132, y - 23, 'X', { size: 10 });
  // 电子束：进入 Y 板后开始上偏
  g.path(`M72,${y}H86Q100,${y} 108,${y - 3.5}L251,${y - 40}`, { c: C.laser, w: 1.2 });
  g.dot(252, y - 40, 2.6, C.laser);
  g.text(262, y - 50, '光点', { size: 9.5, a: 'start', c: C.ink2 });
  g.text(252, y + 72, '荧光屏', { size: 9.5, c: C.ink2 });
  // 两对偏转板上的电压
  g.path(`M84,${y + 44}q3,-6 6,0t6,0t6,0t6,0`, { w: 1, c: C.ink2 }); g.text(96, y + 60, '被测信号', { size: 9, c: C.ink2 });
  g.path(`M126,${y + 48}l8,-8v8l8,-8v8l8,-8`, { w: 1, c: C.ink2 }); g.text(140, y + 60, '锯齿波', { size: 9, c: C.ink2 });
  return g.html('图 1　示波管：Y 偏转板加被测信号，X 偏转板加锯齿波扫描电压，光点偏移量与偏转电压成正比');
}

// ======================= 双臂电桥 =======================
export function kelvinFig() {
  const g = new Fig(300, 200);
  const y0 = 40, y1 = 88, yr = 140, ys = 180, xc = 150;
  // 电流回路：Rx、跨线 r、Rn 串联
  wire(g, [[22, yr], [44, yr]]); res(g, 44, yr, 106, yr, '*R*ₓ', { len: 34, ly: 22 }); wire(g, [[106, yr], [124, yr]]);
  g.line(124, yr, 176, yr, { w: 3 }); g.text(150, yr + 15, '*r*', { size: 10 });
  wire(g, [[176, yr], [194, yr]]); res(g, 194, yr, 256, yr, '*R*ₙ', { len: 34, ly: 22 }); wire(g, [[256, yr], [278, yr]]);
  for (const x of [22, 124, 176, 278]) g.dot(x, yr, 2.2);
  g.text(22, yr - 7, 'C₁', { size: 9, c: C.ink2 }).text(124, yr - 7, 'C₂', { size: 9, c: C.ink2 }).text(176, yr - 7, 'C₁', { size: 9, c: C.ink2 }).text(278, yr - 7, 'C₂', { size: 9, c: C.ink2 });
  // 外臂 R1、R2（接 Rx、Rn 远端的电位端），内臂 R1′、R2′（接近端的电位端）
  wire(g, [[52, yr], [52, y0]]); res(g, 52, y0, xc, y0, '*R*₁', { len: 26 }); res(g, xc, y0, 248, y0, '*R*₂', { len: 26 }); wire(g, [[248, y0], [248, yr]]);
  wire(g, [[98, yr], [98, y1]]); res(g, 98, y1, xc, y1, '*R*₁′', { len: 22 }); res(g, xc, y1, 202, y1, '*R*₂′', { len: 22 }); wire(g, [[202, y1], [202, yr]]);
  for (const [x, y] of [[52, yr], [98, yr], [202, yr], [248, yr], [xc, y0], [xc, y1]]) g.dot(x, y, 2.2);
  g.text(52, yr + 13, 'P₁', { size: 9, c: C.ink2 }).text(98, yr + 13, 'P₂', { size: 9, c: C.ink2 }).text(202, yr + 13, 'P₁', { size: 9, c: C.ink2 }).text(248, yr + 13, 'P₂', { size: 9, c: C.ink2 });
  // 检流计
  wire(g, [[xc, y0], [xc, (y0 + y1) / 2 - 9]]); meter(g, xc, (y0 + y1) / 2, 'G'); wire(g, [[xc, (y0 + y1) / 2 + 9], [xc, y1]]);
  // 电源与换向开关
  wire(g, [[22, yr], [22, ys], [128, ys]]); cell(g, 128, ys, 144, ys, '*E*', { plus: 'l' }); wire(g, [[144, ys], [164, ys]]);
  sw(g, 164, ys, 186, ''); g.text(175, ys - 13, 'K', { size: 10 }); wire(g, [[186, ys], [278, ys], [278, yr]]);
  return g.html('图 1　双臂电桥。<i>R</i><sub>1</sub> = <i>R</i><sub>1</sub>′、<i>R</i><sub>2</sub> = <i>R</i><sub>2</sub>′ 时，平衡条件 <i>R</i><sub>x</sub> = <i>R</i><sub>1</sub><i>R</i><sub>n</sub>/<i>R</i><sub>2</sub>，与跨线电阻 <i>r</i> 和各接触电阻无关');
}
