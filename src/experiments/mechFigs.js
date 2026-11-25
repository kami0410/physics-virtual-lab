// 力学、热学实验原理页的示意图（SVG，坐标为 SVG 用户单位，宽约 280）。
// 几何关系按公式算出，为了看得清楚，小角度（如光杠杆转角）按比例放大画出。
import { Fig, C } from '../core/diagram.js';

const D2R = Math.PI / 180;

// ======================= 光杠杆 =======================
export function ymodulusFig() {
  const g = new Fig(286, 168);
  const P = [72, 118]; // 前足（转轴）
  const rear = 30, dl = 7; // 后足位置、下降量（夸大）
  const th = Math.atan2(dl, P[0] - rear); // 转角 δ
  const rot = ([x, y]) => { const dx = x - P[0], dy = y - P[1], c = Math.cos(-th), s = Math.sin(-th); return [P[0] + dx * c - dy * s, P[1] + dx * s + dy * c]; };
  // 下夹头与平台
  g.rect(24, 118, 12, 18, { c: C.ink, sw: 1, fill: '#e6d9b8' }).text(30, 146, '下夹头', { size: 9, c: C.ink2 });
  g.rect(48, 118, 54, 5, { c: C.ink, sw: 1, fill: '#d5dade' }).text(86, 131, '平台', { size: 9, c: C.ink2 });
  // 光杠杆：原位置（实线）与转过 δ 后（虚线）
  g.line(rear, 118, P[0], 118, { w: 1.6 }).line(P[0], 118, P[0], 114, { w: 1.2 });
  g.line(P[0], 84, P[0], 114, { w: 3, c: '#5d7682' });
  const m1 = rot([P[0], 84]), m2 = rot([P[0], 114]), r0 = rot([rear, 118]);
  g.line(rear, 118 + dl, P[0], 118, { w: 1.2, dash: '3 2', c: C.ink2 });
  g.line(m1[0], m1[1], m2[0], m2[1], { w: 2.2, c: '#8aa0aa', dash: '3 2' });
  g.dot(rear, 118, 2).dot(P[0], 118, 2.2).dot(r0[0], r0[1], 1.6, C.ink2);
  // 望远镜与标尺
  const xs = 258, yt = 100;
  g.rect(206, yt - 5, 30, 10, { fill: '#2f3a44', c: C.ink, sw: 1 }).rect(200, yt - 6.5, 6, 13, { fill: '#1d2832', c: C.ink, sw: 1 });
  g.text(222, yt + 17, '望远镜', { size: 9, c: C.ink2 });
  g.line(xs, 18, xs, 140, { w: 1.4 });
  for (let y = 22; y <= 138; y += 6) g.line(xs, y, xs + ((y - 22) % 30 === 0 ? 8 : 4), y, { w: 0.7 });
  g.text(xs + 2, 12, '标尺', { size: 9, c: C.ink2 });
  // 视线与反射线
  const mc = rot([P[0], 100]);
  g.ray([[200, yt], [P[0], yt]], { c: C.laser, w: 1 });
  const a2 = 2 * th, yn = mc[1] - (xs - mc[0]) * Math.tan(a2);
  g.ray([[mc[0], mc[1]], [xs, yn]], { c: C.laser, w: 1, dash: '4 2' });
  g.dot(xs, yt, 2, C.laser).dot(xs, yn, 2, C.laser);
  g.text(xs - 4, yt + 10, '*n*_{0}', { size: 10, a: 'end' }).text(xs - 4, yn - 6, '*n*', { size: 10, a: 'end' });
  g.dim(xs + 14, yt, xs + 14, yn, '', {});
  g.text(xs + 18, (yt + yn) / 2, 'Δ*n*', { size: 10, a: 'start' });
  // 角度
  g.arc(mc[0], mc[1], 40, -a2 / D2R, 0, '2*δ*', { lr: 8, size: 10 });
  g.arc(P[0], P[1], 26, 180 - th / D2R, 180, '', {});
  g.text(P[0] - 30, P[1] + 13, '*δ*', { size: 10 });
  // 尺寸
  g.dim(rear, 154, P[0], 154, '*b*', { off: -7, size: 10 });
  g.dim(P[0], 162, xs, 162, '*D*', { off: -7, size: 10 });
  g.line(rear, 136, rear, 158, { c: C.ink3, w: 0.5 }).line(P[0], 124, P[0], 166, { c: C.ink3, w: 0.5 }).line(xs, 140, xs, 166, { c: C.ink3, w: 0.5 });
  g.text(2, 122, 'Δ*L*', { size: 10, a: 'start' });
  g.line(14, 118, 24, 118, { c: C.ink3, w: 0.5 }).line(14, 125, 24, 125, { c: C.ink3, w: 0.5 });
  return g.html('图 1　光杠杆原理（角度已夸大）。后足随钢丝下降 Δ<i>L</i>，镜面转过 <i>δ</i>，反射线转过 2<i>δ</i>');
}

// ======================= 三线摆 =======================
export function trifilarFig() {
  const g = new Fig(290, 160);
  // 左：侧视（斜看）
  const cx = 78, yu = 26, yl = 118, ru = [20, 4.5], rl = [52, 11];
  const pt = (c, y, r, a) => [c + r[0] * Math.cos(a * D2R), y + r[1] * Math.sin(a * D2R)];
  g.path(`M${cx - rl[0]},${yl}A${rl[0]},${rl[1]} 0 0 0 ${cx + rl[0]},${yl}v5A${rl[0]},${rl[1]} 0 0 1 ${cx - rl[0]},${yl + 5}Z`, { fill: '#c9a961', c: C.ink, w: 1 });
  g.path(`M${cx - rl[0]},${yl}A${rl[0]},${rl[1]} 0 1 1 ${cx + rl[0]},${yl}A${rl[0]},${rl[1]} 0 1 1 ${cx - rl[0]},${yl}Z`, { fill: '#e3cb8f', c: C.ink, w: 1 });
  g.path(`M${cx - ru[0]},${yu}A${ru[0]},${ru[1]} 0 1 1 ${cx + ru[0]},${yu}A${ru[0]},${ru[1]} 0 1 1 ${cx - ru[0]},${yu}Z`, { fill: '#d5dade', c: C.ink, w: 1 });
  for (const a of [50, 170, 290]) {
    const [x1, y1] = pt(cx, yu, ru, a), [x2, y2] = pt(cx, yl, [rl[0] * 0.8, rl[1] * 0.8], a);
    g.line(x1, y1, x2, y2, { w: 0.9, c: C.ink2 }).dot(x1, y1, 1.6).dot(x2, y2, 1.6);
  }
  g.line(cx, 8, cx, yl + 24, { c: C.ink3, w: 0.6, dash: '6 2 1 2' });
  g.arc(cx, yl + 18, 14, 20, 160, '', { c: C.laser });
  g.head(cx + 14 * Math.cos(160 * D2R), yl + 18 + 14 * Math.sin(160 * D2R), (250) * D2R, { c: C.laser, s: 4.5 });
  g.text(cx + 22, yl + 33, '扭转振动', { size: 9, c: C.laser, a: 'start' });
  g.dim(cx + rl[0] + 12, yu, cx + rl[0] + 12, yl, '*H*', { off: -9, size: 10 });
  g.line(cx + ru[0] + 2, yu, cx + rl[0] + 15, yu, { c: C.ink3, w: 0.5 }).line(cx + rl[0] + 2, yl, cx + rl[0] + 15, yl, { c: C.ink3, w: 0.5 });
  g.text(cx - ru[0] - 4, yu, '上盘', { size: 9, a: 'end', c: C.ink2 }).text(cx - rl[0] - 4, yl + 2, '下盘', { size: 9, a: 'end', c: C.ink2 });
  // 右：悬点俯视
  const ox = 226, oy = 76, RR = 44, rr = 18;
  g.circle(ox, oy, 52, { c: C.ink, w: 1, fill: '#efe3c4' });
  const P = (r, k) => [ox + r * Math.cos((-90 + k * 120) * D2R), oy + r * Math.sin((-90 + k * 120) * D2R)];
  g.poly([P(RR, 0), P(RR, 1), P(RR, 2)], { close: true, c: C.ink2, w: 0.8 });
  g.poly([P(rr, 0), P(rr, 1), P(rr, 2)], { close: true, c: C.ink2, w: 0.8, dash: '3 2' });
  for (let k = 0; k < 3; k++) { const [x, y] = P(RR, k); g.dot(x, y, 2.2); const [u, v] = P(rr, k); g.dot(u, v, 1.6, C.ink2); }
  const [vx, vy] = P(RR, 1); g.line(ox, oy, vx, vy, { c: C.laser, w: 1 }); g.text((ox + vx) / 2 + 6, (oy + vy) / 2 - 6, '*R*', { size: 10, c: C.laser });
  const [ax1, ay1] = P(RR, 1), [ax2, ay2] = P(RR, 2); g.text((ax1 + ax2) / 2, ay1 + 11, '*b*', { size: 10 });
  g.dot(ox, oy, 1.6);
  g.text(ox, oy + 68, '俯视：悬点成等边三角形', { size: 9, c: C.ink2 });
  g.text(ox, oy + 80, '*R* = *b*/√3，*r* = *a*/√3（虚线为上盘）', { size: 9, c: C.ink2 });
  return g.html('图 1　三线摆。下盘转过小角度时升高，在重力作用下作扭转振动');
}

// ======================= 落球法 =======================
export function stokesFig() {
  const g = new Fig(280, 198);
  const x0 = 70, x1 = 140, top = 14, bot = 170, liq = 30, y1 = 62, y2 = 142;
  g.rect(x0, liq, x1 - x0, bot - liq, { fill: '#ecd7a4', c: 'none', sw: 0 });
  g.line(x0, top, x0, bot, { w: 1.6 }).line(x1, top, x1, bot, { w: 1.6 }).line(x0 - 6, bot, x1 + 6, bot, { w: 2 });
  g.line(x0, liq, x1, liq, { w: 0.8, c: C.ink2 });
  for (const y of [y1, y2]) g.line(x0 - 4, y, x1 + 4, y, { w: 2.4, c: C.ink });
  g.text(x0 - 8, y1 + 3, '上标线', { size: 9, a: 'end', c: C.ink2 }).text(x0 - 8, y2 + 3, '下标线', { size: 9, a: 'end', c: C.ink2 });
  const cx = (x0 + x1) / 2;
  g.line(cx, liq + 4, cx, bot - 4, { c: C.ink3, w: 0.6, dash: '6 2 1 2' });
  // 小球与受力
  const by = 100;
  g.circle(cx, by, 5, { fill: '#8a939e', c: C.ink, w: 1 });
  g.line(cx, by + 5, cx, by + 34, { c: C.laser, w: 1.4 }).head(cx, by + 34, Math.PI / 2, { c: C.laser, s: 5 });
  g.text(cx + 4, by + 32, '*mg*', { size: 10, c: C.laser, a: 'start' });
  g.line(cx - 3, by - 5, cx - 3, by - 22, { c: '#2f6f9f', w: 1.4 }).head(cx - 3, by - 22, -Math.PI / 2, { c: '#2f6f9f', s: 5 });
  g.text(cx - 7, by - 16, '*F*_{浮}', { size: 9, c: '#2f6f9f', a: 'end' });
  g.line(cx + 3, by - 5, cx + 3, by - 28, { c: '#3f7d3a', w: 1.4 }).head(cx + 3, by - 28, -Math.PI / 2, { c: '#3f7d3a', s: 5 });
  g.text(cx + 7, by - 22, '6π*ηav*', { size: 9, c: '#3f7d3a', a: 'start' });
  // 尺寸
  g.dim(x1 + 18, y1, x1 + 18, y2, '*L*', { off: -9, size: 10 });
  g.dim(x1 + 46, liq, x1 + 46, bot, '*H*', { off: -9, size: 10 });
  g.line(x1 + 4, liq, x1 + 50, liq, { c: C.ink3, w: 0.5 });
  g.dim(x0, bot + 10, x1, bot + 10, '*D*', { off: 11, size: 10 });
  // 速度-时间示意
  const px = 212, py = 74, pw = 60, ph = 44;
  g.line(px, py + ph, px + pw, py + ph, { w: 0.8 }).line(px, py + ph, px, py - 6, { w: 0.8 });
  g.path(`M${px},${py + ph}C${px + 6},${py + 6} ${px + 14},${py} ${px + pw},${py}`, { c: C.laser, w: 1.2 });
  g.line(px, py, px + pw, py, { c: C.ink3, w: 0.5, dash: '3 2' });
  g.text(px - 3, py + 3, '*v*_{0}', { size: 9, a: 'end' }).text(px + pw, py + ph + 11, '*t*', { size: 9 }).text(px - 3, py - 6, '*v*', { size: 9, a: 'end' });
  g.text(px + pw / 2, py + ph + 24, '很快达到收尾速度', { size: 9, c: C.ink2 });
  return g.html('图 1　落球法。小球匀速通过两标线之间的距离 <i>L</i>，记下时间 <i>t</i>');
}

// ======================= 声速 =======================
export function soundFig() {
  const g = new Fig(290, 176);
  const xa = 52, xb = 196, yc = 52, A = 22;
  // 换能器
  g.rect(xa - 26, yc - 18, 22, 36, { fill: '#d5dade', c: C.ink, sw: 1 }).rect(xa - 4, yc - 15, 4, 30, { fill: '#9aa3ad', c: C.ink, sw: 1 });
  g.rect(xb + 4, yc - 18, 22, 36, { fill: '#d5dade', c: C.ink, sw: 1 }).rect(xb, yc - 15, 4, 30, { fill: '#9aa3ad', c: C.ink, sw: 1 });
  g.text(xa - 15, yc + 30, 'S₁', { size: 10 }).text(xb + 15, yc + 30, 'S₂', { size: 10 });
  // 驻波包络（L = 3λ/2 时）
  const L = xb - xa, k = (3 * Math.PI) / L;
  const env = (s) => { let d = ''; for (let i = 0; i <= 120; i++) { const x = xa + (i / 120) * L, y = yc + s * A * Math.abs(Math.cos(k * (x - xb))); d += (i ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1); } return d; };
  g.path(env(1), { c: '#0f766e', w: 1.2 }).path(env(-1), { c: '#0f766e', w: 1.2 });
  g.line(xa, yc, xb, yc, { c: C.ink3, w: 0.5, dash: '3 2' });
  g.dim(xb - L / 3, yc + A + 12, xb, yc + A + 12, '*λ*/2', { off: 9, size: 10 });
  g.text((xa + xb) / 2, yc - A - 6, '声压振幅（L = 3λ/2 时）', { size: 9, c: C.ink2 });
  g.line(xb + 30, yc, xb + 48, yc, { w: 1 }).head(xb + 48, yc, 0, { s: 4.5 }).text(xb + 52, yc + 3, 'CH2', { size: 9, a: 'start' });
  g.line(xa - 46, yc, xa - 28, yc, { w: 1 }).head(xa - 28, yc, 0, { s: 4.5 }).text(xa - 48, yc + 3, '~', { size: 11, a: 'end' });
  // 李萨如图形随相位差变化
  const y0 = 140, R = 13, names = ['0', 'π/4', 'π/2', '3π/4', 'π', '3π/2', '2π'], phs = [0, 0.25, 0.5, 0.75, 1, 1.5, 2];
  phs.forEach((p, i) => {
    const cx = 34 + i * 38;
    g.rect(cx - R - 3, y0 - R - 3, 2 * R + 6, 2 * R + 6, { fill: '#0b1410', c: C.ink, sw: 0.6 });
    let d = '';
    for (let j = 0; j <= 64; j++) { const t = (j / 64) * 2 * Math.PI; d += (j ? 'L' : 'M') + (cx + R * Math.sin(t)).toFixed(1) + ',' + (y0 - R * 0.9 * Math.sin(t + p * Math.PI)).toFixed(1); }
    g.path(d, { c: '#7dff9e', w: 1 });
    g.text(cx, y0 + R + 13, names[i], { size: 9 });
  });
  g.text(4, y0 + R + 13, 'Δ*φ*', { size: 9, a: 'start' });
  return g.html('图 1　上：两换能器之间的驻波，S₂ 每移动 λ/2 出现一次振幅极大。下：X-Y 方式下的李萨如图形，S₂ 每移动 λ，图形复原一次');
}

// ======================= 稳态平板法 =======================
export function leeFig() {
  const g = new Fig(290, 170);
  const x0 = 30, w = 122, yA = 26, hA = 20, hB = 16, hP = 16;
  const yB = yA + hA, yP = yB + hB;
  g.rect(x0 + 20, yA - 16, w - 40, 16, { fill: '#c9ced3', c: C.ink, sw: 1 }).text(x0 + w / 2, yA - 5, '电热丝', { size: 9, c: C.ink2 });
  g.rect(x0, yA, w, hA, { fill: '#e0b483', c: C.ink, sw: 1 }).text(x0 + w * 0.36, yA + 13, 'A　发热盘', { size: 9 });
  g.rect(x0, yB, w, hB, { fill: '#4b4b4f', c: C.ink, sw: 1 }).text(x0 + w * 0.36, yB + 11, 'B　样品', { size: 9, c: '#fff' });
  g.rect(x0, yP, w, hP, { fill: '#e0b483', c: C.ink, sw: 1 }).text(x0 + w * 0.36, yP + 11, 'P　散热盘', { size: 9 });
  for (const f of [0.2, 0.5, 0.8]) g.line(x0 + w * f, yP + hP, x0 + w * f, yP + hP + 26, { w: 1.6, c: C.ink2 });
  g.line(x0 - 6, yP + hP + 26, x0 + w + 6, yP + hP + 26, { w: 1.6 });
  // 传感器
  g.dot(x0 + w - 7, yA + hA - 5, 2.2, C.laser).text(x0 + w + 4, yA + hA - 3, '*T*_{1}', { size: 10, a: 'start', c: C.laser });
  g.dot(x0 + w - 7, yP + 5, 2.2, '#2f6f9f').text(x0 + w + 4, yP + 4, '*T*_{2}', { size: 10, a: 'start', c: '#2f6f9f' });
  // 热流与散热
  for (const f of [0.72, 0.86]) { g.line(x0 + w * f, yB - 2, x0 + w * f, yP + 2, { c: C.laser, w: 1.2 }); g.head(x0 + w * f, yP + 2, Math.PI / 2, { c: C.laser, s: 4 }); }
  for (const [x, y, a] of [[x0 - 3, yP + hP - 4, Math.PI], [x0 + w + 3, yP + hP - 3, 0], [x0 + w * 0.36, yP + hP + 4, Math.PI / 2]]) { const dx = Math.cos(a) * 10, dy = Math.sin(a) * 10; g.line(x, y, x + dx, y + dy, { c: '#2f6f9f', w: 1, dash: '2 2' }); g.head(x + dx, y + dy, a, { c: '#2f6f9f', s: 3.5 }); }
  g.dim(x0 - 8, yB, x0 - 8, yP, '*h*_{B}', { off: 11, size: 9 });
  // 冷却曲线
  const px = 186, py = 26, pw = 94, ph = 96, T = (t) => py + ph - (ph - 6) * Math.exp(-t / 70) - 4;
  g.line(px, py + ph, px + pw, py + ph, { w: 0.8 }).line(px, py + ph, px, py - 4, { w: 0.8 });
  let d = ''; for (let i = 0; i <= 60; i++) { const t = (i / 60) * pw; d += (i ? 'L' : 'M') + (px + t).toFixed(1) + ',' + (py + ph - (ph - 8) * Math.exp(-t / 55) - 4).toFixed(1); }
  g.path(d, { c: C.laser, w: 1.3 });
  const t2 = 30, y2 = py + ph - (ph - 8) * Math.exp(-t2 / 55) - 4, sl = ((ph - 8) / 55) * Math.exp(-t2 / 55);
  g.line(px + t2 - 24, y2 - 24 * sl, px + t2 + 34, y2 + 34 * sl, { c: C.ink, w: 0.9, dash: '4 2' });
  g.line(px, y2, px + t2, y2, { c: C.ink3, w: 0.5, dash: '2 2' }).dot(px + t2, y2, 2);
  g.text(px - 3, y2 + 3, '*T*_{2}', { size: 9, a: 'end' }).text(px + pw, py + ph + 11, '*t*', { size: 9 }).text(px - 3, py - 2, '*T*', { size: 9, a: 'end' });
  g.text(px + pw / 2 + 6, py + ph + 24, 'P 的冷却曲线', { size: 9, c: C.ink2 });
  void T;
  return g.html('图 1　稳态平板法。稳态时，经样品 B 传入散热盘 P 的热量等于 P 在温度 <i>T</i><sub>2</sub> 下向空气散失的热量；后者由 P 的冷却曲线在 <i>T</i><sub>2</sub> 处的斜率求出');
}
