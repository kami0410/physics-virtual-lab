// 各实验原理页的光路图。坐标单位为 SVG 用户单位（宽约 280，与左侧原理栏的宽度相当）。
// 光线位置由几何光学计算：薄透镜按高斯公式、棱镜和界面按斯涅尔定律、干涉装置按反射镜像关系。
import { Fig, C, V, refract } from '../core/diagram.js';

const D2R = Math.PI / 180;

/** 薄透镜：高度 h、斜率 s 的光线经焦距 f 的透镜后的斜率 */
const thin = (h, s, f) => s - h / f;

// ======================= 薄透镜 =======================
export function lensImaging() {
  const g = new Fig(280, 160), ay = 78, xl = 140, f = 40, u = 70, ho = 26;
  const v = (u * f) / (u - f), hi = (-ho * v) / u, xo = xl - u, xi = xl + v;
  const O = [xo, ay - ho], I = [xi, ay - hi];
  g.axis(8, ay, 272);
  g.lens(xl, ay, 104, { label: 'L', below: true });
  g.dot(xl - f, ay, 1.8).text(xl - f - 4, ay - 9, 'F').dot(xl + f, ay, 1.8).text(xl + f + 1, ay - 9, 'F′');
  const ext = (p, q, k) => [q[0] + (q[0] - p[0]) * k, q[1] + (q[1] - p[1]) * k];
  // ① 平行于光轴 → 过像方焦点；② 过光心不偏折；③ 过物方焦点 → 平行于光轴
  g.ray([O, [xl, O[1]], ext([xl, O[1]], I, 0.15)], { c: C.lamp });
  g.ray([O, ext(O, I, 0.08)], { c: C.lamp });
  const y3 = O[1] + ((ay - O[1]) / (xl - f - xo)) * u;
  g.ray([O, [xl, y3], [xi + 14, y3]], { c: C.lamp });
  g.objArrow(xo, ay, O[1]).objArrow(xi, ay, I[1], { c: C.ink2 });
  g.text(xo - 2, O[1] - 8, '物', { size: 10.5 }).text(xi + 2, I[1] + 9, '像', { size: 10.5 });
  g.dim(xo, 150, xl, 150, '*u*', { off: -7 }).dim(xl, 150, xi, 150, '*v*', { off: -7 });
  g.dim(xl, 14, xl + f, 14, '*f*', { off: -7 });
  return g.html('图 1　薄透镜成像：三条特征光线确定像的位置');
}

export function lensBessel() {
  const g = new Fig(280, 136), ay = 66, xo = 14, xs = 236, L = xs - xo, f = 40;
  const r = Math.sqrt(L * L - 4 * f * L), u1 = (L - r) / 2, u2 = (L + r) / 2;
  const x1 = xo + u1, x2 = xo + u2, ho = 9;
  g.axis(6, ay, 244);
  g.objArrow(xo, ay, ay - ho);
  g.lens(x1, ay, 70, { label: '位置 1' });
  g.lens(x2, ay, 70, { label: '位置 2' });
  g.screen(xs, ay - 44, ay + 44);
  // 两个位置各画一条过光心的光线，像高分别为 β₁、β₂ 倍（互为倒数）
  const h1 = (ho * (L - u1)) / u1, h2 = (ho * (L - u2)) / u2;
  g.ray([[xo, ay - ho], [xs, ay + h1]], { c: C.lamp, w: 1 });
  g.ray([[xo, ay - ho], [xs, ay + h2]], { c: C.lamp, w: 1, dash: '4 2.5' });
  g.objArrow(xs - 5, ay, ay + h1, { c: C.ink2, w: 1.3 }).objArrow(xs - 9, ay, ay + h2, { c: C.ink2, w: 1.3 });
  g.text(xs + 6, ay + h1 - 4, '放大像', { a: 'start', size: 10 }).text(xs + 6, ay - 9, '缩小像', { a: 'start', size: 10 });
  g.dim(xo, 126, xs, 126, '*L*', { off: -7 });
  g.dim(x1, 110, x2, 110, '*d*', { off: -7 });
  return g.html('图 2　二次成像法：物、屏不动，透镜在两处都能成清晰像');
}

export function lensAutocollimation() {
  const g = new Fig(280, 136), ay = 74, xo = 40, f = 92, xl = xo + f, xm = 244, ho = 16;
  g.axis(10, ay, 270);
  g.lens(xl, ay, 96); g.text(xl + 12, ay - 50, 'L', { size: 10.5 });
  g.mirror(xm, ay - 48, xm, ay + 48, { side: -1, label: '平面镜', lx: 14, ly: 58 });
  g.objArrow(xo, ay, ay - ho);
  g.text(xo - 4, ay - ho - 8, '物', { size: 10.5 });
  // 物点在焦平面上：经透镜后成为一束平行光（方向与过光心的光线相同），反射后再会聚于焦平面上的对称点
  const s = ho / f; // 平行光斜率（向下）
  for (const yl of [ay - 40, ay - 12, ay + 20]) {
    const yM = yl + s * (xm - xl), yBack = yM + s * (xm - xl);
    g.ray([[xo, ay - ho], [xl, yl], [xm, yM]], { c: C.lamp, w: 1 });
    g.ray([[xm, yM], [xl, yBack], [xo, ay + ho]], { c: C.lamp, w: 1, dash: '4 2.5' });
  }
  g.objArrow(xo, ay, ay + ho, { c: C.ink2, w: 1.3 });
  g.text(xo - 4, ay + ho + 9, '像', { size: 10.5 });
  g.dim(xo, 12, xl, 12, '*f*', { off: -7 });
  return g.html('图 3　自准直法：物在焦平面上时，反射回来的光在物平面上成倒立等大的像');
}

// ======================= 迈克尔逊干涉仪 =======================
export function michelsonLayout() {
  const g = new Fig(280, 212), cx = 112, cy = 118;
  const m2y = 26, m1x = cx + (cy - m2y) + 24, m2pX = cx + (cy - m2y); // M₂′ 是 M₂ 关于 G₁ 的镜像
  const o = 2.2; // 去程与回程光线错开一点，便于看清
  // 光路
  g.ray([[14, cy], [cx, cy]], { c: C.laser });
  g.ray([[cx, cy - o], [m1x, cy - o]], { c: C.laser });
  g.ray([[m1x, cy + o], [cx + o, cy + o], [cx + o, 200]], { c: C.laser });
  g.ray([[cx - o, cy], [cx - o, m2y]], { c: C.laser });
  g.ray([[cx + o, m2y], [cx + o, cy + o]], { c: C.laser, arrows: 'none' });
  // 元件
  g.plate(cx - 15, cy + 15, cx + 15, cy - 15, 4, { label: 'G₁', lx: -20, ly: 16 });
  g.plate(cx + 30 - 15, cy + 15, cx + 30 + 15, cy - 15, 4, { label: 'G₂', lx: 14, ly: 16 });
  g.mirror(m1x, cy - 26, m1x, cy + 26, { side: -1, label: 'M₁', lx: 4, ly: -34 });
  g.arrow(m1x + 8, cy + 34, m1x + 24, cy + 34, { c: C.ink2, w: 0.8, s: 4.5 }).arrow(m1x + 16, cy + 34, m1x, cy + 34, { c: C.ink2, w: 0.8, s: 4.5 });
  g.text(m1x + 12, cy + 44, '可移动', { size: 9.5, c: C.ink2 });
  g.mirror(cx - 26, m2y, cx + 26, m2y, { side: 1, label: 'M₂', lx: 38, ly: 0 });
  g.line(m2pX, cy - 26, m2pX, cy + 26, { c: C.ink2, w: 1, dash: '3 2.5' });
  g.text(m2pX - 4, cy - 34, 'M₂′', { size: 10.5, c: C.ink2 });
  g.dim(m2pX, cy - 18, m1x, cy - 18, '', { c: C.ink2 });
  g.text((m2pX + m1x) / 2, cy - 26, '*d*', { size: 11 });
  g.text(14, cy - 9, 'S（扩束后的激光）', { a: 'start', size: 10 });
  g.text(cx + 30, cy + 34, '补偿板', { size: 9.5, c: C.ink2 });
  g.line(cx - 22, 202, cx + 22, 202, { c: C.ink, w: 2.6 });
  g.text(cx + 34, 202, 'E（观察屏）', { a: 'start', size: 10 });
  return g.html('图 1　迈克尔逊干涉仪光路（俯视）。M₂′ 是 M₂ 经 G₁ 所成的虚像');
}

export function michelsonFilm() {
  const g = new Fig(280, 126), y1 = 40, y2 = 86, d = y2 - y1, th = 30 * D2R;
  const A = [92, y1], tt = Math.tan(th);
  const B = [A[0] + d * tt, y2], Cc = [A[0] + 2 * d * tt, y1];
  g.line(20, y1, 246, y1, { c: C.ink2, w: 1, dash: '4 2.5' }).text(252, y1, 'M₂′', { a: 'start', size: 10.5, c: C.ink2 });
  g.mirror(20, y2, 246, y2, { side: 1 }).text(252, y2, 'M₁', { a: 'start', size: 10.5 });
  const L = 52, inc = [A[0] - L * Math.sin(th), y1 - L * Math.cos(th)];
  g.ray([inc, A], { c: C.laser });
  g.ray([A, [A[0] + L * Math.sin(th), y1 - L * Math.cos(th)]], { c: C.laser });
  g.ray([A, B, Cc], { c: C.laser });
  g.ray([Cc, [Cc[0] + L * Math.sin(th), y1 - L * Math.cos(th)]], { c: C.laser });
  g.line(A[0], y1 - 34, A[0], y2 + 6, { c: C.ink3, w: 0.6, dash: '3 2' });
  g.arc(A[0], A[1], 20, -90, -90 - 30, '*θ*', { lr: 8 });
  // 两束反射光的光程差 Δ = 2d·cosθ：从 C 作第一束反射光的垂线
  const r1 = [Math.sin(th), -Math.cos(th)], N = V.add(A, V.mul(r1, V.dot(V.sub(Cc, A), r1)));
  g.line(Cc[0], Cc[1], N[0], N[1], { c: C.ink3, w: 0.7, dash: '2.5 2' });
  g.dim(226, y1, 226, y2, '*d*', { off: 8 });
  g.text(150, 114, '光程差 Δ = 2*d* cos*θ*', { size: 11 });
  return g.html('图 2　等倾干涉：M₁ 与 M₂′ 之间相当于厚度为 d 的空气薄膜');
}

// ======================= 牛顿环 =======================
export function newtonRings() {
  const g = new Fig(280, 140), cx = 140, yp = 96, R = 300, half = 112;
  const sag = (x) => R - Math.sqrt(R * R - x * x); // 透镜下表面离平板的高度
  // 平板
  g.rect(18, yp, 244, 12, { c: C.glassEdge, fill: C.glass });
  // 平凸透镜：上表面平，下表面为球面
  let d = `M${cx - half},${yp - sag(half)}`;
  for (let x = -half; x <= half; x += 4) d += `L${cx + x},${(yp - sag(x)).toFixed(2)}`;
  d += `L${cx + half},${yp - 46}L${cx - half},${yp - 46}Z`;
  g.path(d, { c: C.glassEdge, fill: C.glass, w: 0.9 });
  g.line(cx, 14, cx, yp + 18, { c: C.ink3, w: 0.6, dash: '6 2 1.5 2' });
  // 半径 r 处的空气层厚度 e
  const r = 80, e = sag(r);
  g.line(cx + r, yp - e, cx + r, yp, { c: C.ink, w: 0.8 });
  g.text(cx + r + 7, yp - e / 2, '*e*', { size: 11, a: 'start' });
  g.dim(cx, yp + 24, cx + r, yp + 24, '*r*', { off: 8 });
  // 曲率半径 R：从球心（在图外上方）指向球面
  const ang = Math.asin(r / R), L = 70;
  g.arrow(cx + r - L * Math.sin(ang), yp - e - L * Math.cos(ang), cx + r, yp - e, { c: C.ink2, w: 0.8, s: 4.5 });
  g.text(cx + r - 30, yp - e - 52, '*R*', { size: 11 });
  // 垂直入射的钠光与两束反射光
  const xr = cx - 70, er = sag(70);
  g.ray([[xr, 6], [xr, yp]], { c: C.lamp, arrows: 'mid' });
  g.ray([[xr - 4, yp - er], [xr - 4, 12]], { c: C.lamp, w: 0.9 });
  g.ray([[xr - 8, yp], [xr - 8, 12]], { c: C.lamp, w: 0.9 });
  g.text(xr - 28, 18, '1  2', { size: 10, c: C.ink2 });
  g.text(250, yp + 6, '平板玻璃', { size: 10, a: 'end' });
  g.text(cx + 104, yp - 36, '平凸透镜', { size: 10, a: 'end' });
  return g.html('图 1　牛顿环装置截面（厚度方向放大）：空气层上、下表面反射的光 1、2 发生干涉');
}

// ======================= 劈尖 =======================
export function wedgeFig() {
  const g = new Fig(280, 136), x0 = 26, xL = 236, yb = 92, D = 24;
  const top = (x) => yb - ((x - x0) / (xL - x0)) * D;
  g.rect(14, yb, 246, 10, { c: C.glassEdge, fill: C.glass });
  g.poly([[x0, yb], [xL + 12, top(xL + 12)], [xL + 12, top(xL + 12) - 9], [x0 - 4, yb - 9]], { close: true, c: C.glassEdge, fill: C.glass, w: 0.9 });
  g.circle(xL, yb - D / 2, D / 2, { c: C.ink, w: 1, fill: '#c9cfd2' });
  g.callout(xL + 6, yb - D + 2, 256, 34, '细丝', { a: 'end' });
  // 暗纹处厚度 e_k = kλ/2，等间距 l
  const n = 7, step = (xL - x0) / n;
  for (let k = 1; k < n; k++) { const x = x0 + k * step; g.line(x, top(x), x, yb, { c: k === 3 ? C.ink : C.ink3, w: k === 3 ? 1 : 0.6 }); }
  g.text(x0 + 3 * step - 4, yb - 7, '*e*_{k}', { size: 10.5, a: 'end' });
  g.dim(x0 + 5 * step, yb + 18, x0 + 6 * step, yb + 18, '*l*', { off: 8 });
  g.dim(x0, yb + 34, xL, yb + 34, '*L*', { off: -7 });
  g.dim(xL + 20, yb, xL + 20, yb - D, '*D*', { off: 8 });
  const ang = Math.atan(D / (xL - x0)) / D2R;
  g.arc(x0, yb, 46, -ang, 0, '', {});
  g.text(x0 + 56, yb - 3, '*θ*', { size: 11 });
  for (const x of [84, 134, 184]) g.ray([[x, 8], [x, top(x)]], { c: C.lamp, w: 0.9 });
  return g.html('图 1　劈尖干涉（角度已放大）：相邻暗纹处空气层厚度相差 λ/2');
}

// ======================= 杨氏双缝 =======================
export function youngFig() {
  const g = new Fig(280, 168), ay = 84, xs = 22, xd = 100, xe = 250, dh = 20;
  const S = [xs, ay], S1 = [xd, ay - dh], S2 = [xd, ay + dh], P = [xe, ay - 46];
  g.axis(10, ay, 272);
  g.slitPlate(xs, ay - 40, ay + 40, [[ay - 2, ay + 2]], { label: 'S' });
  g.slitPlate(xd, ay - 58, ay + 58, [[S1[1] - 2, S1[1] + 2], [S2[1] - 2, S2[1] + 2]]);
  g.text(xd - 10, S1[1] - 6, 'S₁', { size: 10.5 }).text(xd - 10, S2[1] + 7, 'S₂', { size: 10.5 });
  g.screen(xe, ay - 66, ay + 66, { label: '' });
  g.ray([S, S1], { c: C.lamp, w: 1 }).ray([S, S2], { c: C.lamp, w: 1 });
  g.ray([S1, P], { c: C.lamp, w: 1 }).ray([S2, P], { c: C.lamp, w: 1 });
  // 从 S₁ 向 S₂P 作垂线，S₂N 就是光程差 δ ≈ d sinθ
  const u = V.unit(V.sub(P, S2)), N = V.add(S2, V.mul(u, V.dot(V.sub(S1, S2), u)));
  g.line(S1[0], S1[1], N[0], N[1], { c: C.ink3, w: 0.7, dash: '2.5 2' });
  g.line(S2[0], S2[1], N[0], N[1], { c: C.ink, w: 2 });
  g.text(N[0] + 4, N[1] + 10, '*δ*', { size: 11 });
  // 中心线与观察方向的夹角 θ
  const M = [xd, ay];
  g.line(M[0], M[1], P[0], P[1], { c: C.ink3, w: 0.6, dash: '3 2' });
  g.arc(M[0], M[1], 46, -Math.atan2(ay - P[1], xe - xd) / D2R, 0, '*θ*', { lr: 9 });
  g.dot(P[0], P[1], 2).text(P[0] + 8, P[1], 'P', { a: 'start' });
  g.dim(xe + 10, ay, xe + 10, P[1], '*x*', { off: 8 });
  g.dim(xd - 20, S1[1], xd - 20, S2[1], '*d*', { off: 8 });
  g.dim(xs, ay + 72, xd, ay + 72, '*R*', { off: -7 }).dim(xd, ay + 72, xe, ay + 72, '*D*', { off: -7 });
  return g.html('图 1　杨氏双缝干涉（间距已放大）：P 点的光程差 δ ≈ d·sinθ ≈ dx/D');
}

// ======================= 菲涅耳双棱镜 =======================
export function biprismFig() {
  const g = new Fig(280, 172), ay = 82, xs = 36, xp = 106, xe = 262, dh = 20, top = 50;
  const S = [xs, ay], S1 = [xs, ay - dh], S2 = [xs, ay + dh];
  const atX = (P, Q, x) => P[1] + ((Q[1] - P[1]) * (x - P[0])) / (Q[0] - P[0]);
  g.axis(10, ay, 272);
  // 重叠区（干涉区）：两半棱镜过棱脊的光线之间
  g.poly([[xp, ay], [xe, atX(S2, [xp, ay], xe)], [xe, atX(S1, [xp, ay], xe)]], { close: true, c: 'none', fill: '#f3dcae', op: 0.8 });
  g.text(222, ay, '干涉区', { size: 10.5, c: C.ink2 });
  // 上半棱镜的光好像从 S₁ 发出，下半棱镜的光好像从 S₂ 发出
  for (const yh of [top, ay]) {
    const Ph = [xp, yh], Pl = [xp, 2 * ay - yh];
    g.ray([S, Ph, [xe, atX(S1, Ph, xe)]], { c: C.lamp, w: 1 });
    g.ray([S, Pl, [xe, atX(S2, Pl, xe)]], { c: C.lamp, w: 1 });
    g.line(S1[0], S1[1], xp, yh, { c: C.ink3, w: 0.6, dash: '3 2' });
    g.line(S2[0], S2[1], xp, 2 * ay - yh, { c: C.ink3, w: 0.6, dash: '3 2' });
  }
  g.poly([[xp - 4, ay], [xp + 4, top - 6], [xp + 4, 2 * ay - top + 6]], { close: true, c: C.glassEdge, fill: C.glass, w: 0.9 });
  g.text(xp + 2, top - 14, '双棱镜', { size: 10 });
  g.slitPlate(xs, ay - 30, ay + 30, [[ay - 2, ay + 2]]);
  g.text(xs + 8, ay + 38, 'S', { size: 10.5 });
  g.dot(S1[0], S1[1], 1.8, C.ink2).dot(S2[0], S2[1], 1.8, C.ink2);
  g.text(xs - 8, S1[1] - 8, 'S₁', { size: 10.5, c: C.ink2 }).text(xs - 8, S2[1] + 9, 'S₂', { size: 10.5, c: C.ink2 });
  g.dim(xs - 18, S1[1], xs - 18, S2[1], '*d*', { off: 7 });
  g.screen(xe, ay - 62, ay + 62);
  g.dim(xs, 148, xp, 148, '*a*', { off: -7 });
  g.dim(xs, 164, xe, 164, '*D*', { off: -7 });
  return g.html('图 1　双棱镜干涉（角度已放大）：虚光源 S₁、S₂ 的光在重叠区干涉');
}

// ======================= 单缝衍射 =======================
export function slitFig() {
  const g = new Fig(280, 162), ay = 80, xs = 64, xl = 150, f = 80, xe = xl + f, a = 40, th = 14 * D2R;
  const t = Math.tan(th), P = [xe, ay + f * t];
  g.axis(6, ay, 274);
  for (const y of [ay - 30, ay - 12, ay + 12, ay + 30]) g.ray([[8, y], [xs, y]], { c: C.laser, w: 0.9 });
  g.slitPlate(xs, ay - 62, ay + 62, [[ay - a / 2, ay + a / 2]]);
  g.lens(xl, ay, 104, { label: 'L' });
  g.screen(xe, ay - 66, ay + 66);
  const A = [xs, ay - a / 2], B = [xs, ay + a / 2];
  for (const y0 of [A[1], ay, B[1]]) g.ray([[xs, y0], [xl, y0 + (xl - xs) * t], P], { c: C.laser, w: 1 });
  g.ray([[xs, ay], [xl, ay], [xe, ay]], { c: C.laser, w: 0.7, op: 0.45, arrows: 'none' });
  // 光程差 a·sinθ：从 B 作 A 那条光线的垂线
  const dvec = [Math.cos(th), Math.sin(th)], N = V.add(A, V.mul(dvec, V.dot(V.sub(B, A), dvec)));
  g.line(B[0], B[1], N[0], N[1], { c: C.ink3, w: 0.7, dash: '2.5 2' });
  g.line(A[0], A[1], N[0], N[1], { c: C.ink, w: 2 });
  g.text(N[0] + 16, N[1] - 9, '*a* sin*θ*', { size: 10.5, bg: true });
  g.dim(xs - 14, A[1], xs - 14, B[1], '*a*', { off: -8 });
  g.arc(xl, ay, 28, 0, th / D2R, '*θ*', { lr: 8 });
  g.line(xl, ay, P[0], P[1], { c: C.ink3, w: 0.6, dash: '3 2' });
  g.dot(P[0], P[1], 2);
  // 屏后画出光强分布 I = I₀(sin u/u)²
  let d = '';
  for (let y = ay - 64; y <= ay + 64; y += 0.8) {
    const u = (y - ay) / 6.5, I = Math.abs(u) < 1e-6 ? 1 : (Math.sin(u) / u) ** 2;
    d += `${d ? 'L' : 'M'}${(xe + 4 + 34 * I).toFixed(1)},${y.toFixed(1)}`;
  }
  g.path(d, { c: C.ink, w: 1 });
  g.text(xe + 24, ay - 70, '*I*', { size: 11 });
  g.dim(xl, 152, xe, 152, '*f*', { off: -7 });
  return g.html('图 1　夫琅禾费单缝衍射：缝边缘两条光线的光程差为 a·sinθ');
}

// ======================= 分光计与光栅 =======================
export function gratingFig() {
  const g = new Fig(280, 190), cx = 128, cy = 98, th = 28;
  g.circle(cx, cy, 78, { c: C.ink3, w: 0.6 });
  g.text(cx - 40, cy + 86, '刻度盘', { size: 9.5, c: C.ink2 });
  for (const [t, a] of [['游标 A', 228], ['游标 B', 48]]) { const x = cx + 78 * Math.cos(a * D2R), y = cy + 78 * Math.sin(a * D2R); g.rect(x - 3, y - 3, 6, 6, { c: C.ink, fill: '#fff' }); g.text(x + (a > 90 ? -6 : 6), y + (a > 90 ? -8 : 8), t, { size: 9.5, a: a > 90 ? 'end' : 'start', c: C.ink2 }); }
  // 平行光管
  g.rect(14, cy - 9, 80, 18, { c: C.ink, fill: '#e6ebe8' });
  g.line(16, cy - 3, 16, cy + 3, { c: C.ink, w: 2 });
  g.lens(90, cy, 18);
  g.text(54, cy + 20, '平行光管', { size: 10 });
  for (const y of [cy - 5, cy, cy + 5]) g.ray([[18, cy], [90, y], [cx - 2, y]], { c: C.lamp, w: 0.8, arrows: 'none' });
  // 光栅（竖放，垂直于入射光）
  g.line(cx, cy - 16, cx, cy + 16, { c: C.ink, w: 2.2 });
  for (let y = cy - 14; y <= cy + 14; y += 3) g.line(cx - 2, y, cx + 2, y, { c: C.ink, w: 0.6 });
  g.text(cx - 4, cy - 24, '光栅', { size: 10 });
  // 各级衍射光
  for (const [k, a] of [[0, 0], [1, -th], [-1, th]]) {
    const dx = Math.cos(a * D2R), dy = Math.sin(a * D2R);
    g.ray([[cx, cy], [cx + 120 * dx, cy + 120 * dy]], { c: C.lamp, w: 1 });
    g.text(cx + 134 * dx, cy + 134 * dy, `*k* = ${k > 0 ? '+' : k < 0 ? '−' : ''}${Math.abs(k)}`, { size: 10.5 });
  }
  // 望远镜对准 +1 级
  const a = -th * D2R, ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
  const p0 = [cx + 52 * ux, cy + 52 * uy], p1 = [cx + 108 * ux, cy + 108 * uy];
  g.poly([[p0[0] + nx * 8, p0[1] + ny * 8], [p1[0] + nx * 8, p1[1] + ny * 8], [p1[0] - nx * 8, p1[1] - ny * 8], [p0[0] - nx * 8, p0[1] - ny * 8]], { close: true, c: C.ink, fill: 'rgba(230,235,232,.6)' });
  g.text(p1[0] - nx * 22 - 4, p1[1] - ny * 22 + 4, '望远镜', { size: 10 });
  g.arc(cx, cy, 40, -th, 0, '*θ*', { lr: 9 });
  return g.html('图 1　分光计观察光栅衍射（俯视）：d sinθ = kλ');
}

// ======================= 三棱镜 =======================
export function prismFig() {
  const g = new Fig(280, 156), n = 1.65, A = 60;
  const apex = [140, 22], side = 128, h = side * Math.sin(60 * D2R);
  const BL = [apex[0] - side / 2, apex[1] + h], BR = [apex[0] + side / 2, apex[1] + h];
  g.poly([apex, BL, BR], { close: true, c: C.glassEdge, fill: C.glass, w: 1 });
  // 最小偏向角：棱镜内光线平行于底边；两侧按斯涅尔定律求入射与出射方向
  const yIn = apex[1] + h * 0.55, t = (yIn - apex[1]) / h;
  const P1 = [apex[0] - (side / 2) * t, yIn], P2 = [apex[0] + (side / 2) * t, yIn];
  const nL = V.unit([-(BL[1] - apex[1]), BL[0] - apex[0]]), nR = V.unit([BR[1] - apex[1], -(BR[0] - apex[0])]);
  const dIn = V.mul(refract([-1, 0], nL, n, 1), -1), dOut = refract([1, 0], nR, n, 1);
  const L = 92, P0 = V.sub(P1, V.mul(dIn, L)), P3 = V.add(P2, V.mul(dOut, L));
  g.ray([P0, P1, P2, P3], { c: C.lamp, w: 1.2 });
  // 入射光的延长线与出射光的夹角就是偏向角
  const ext = V.add(P1, V.mul(dIn, 112));
  g.line(P1[0], P1[1], ext[0], ext[1], { c: C.ink3, w: 0.7, dash: '3 2' });
  const X = [P1[0] + ((P2[0] - P1[0]) / 2) * 0 + 0, 0];
  // 两条线交点：棱镜对称轴上
  const tx = (apex[0] - P1[0]) / dIn[0], Q = V.add(P1, V.mul(dIn, tx));
  g.line(P2[0], P2[1], Q[0], Q[1], { c: C.ink3, w: 0.7, dash: '3 2' });
  const a1 = Math.atan2(dIn[1], dIn[0]) / D2R, a2 = Math.atan2(dOut[1], dOut[0]) / D2R;
  g.arc(Q[0], Q[1], 50, a1, a2, '*δ*ₘᵢₙ', { lr: 14 });
  g.arc(apex[0], apex[1], 18, 120, 60, '', {});
  g.text(apex[0], apex[1] + 28, '*A*', { size: 11 });
  // 两个面的法线
  for (const [P, nn] of [[P1, nL], [P2, nR]]) g.line(P[0] - nn[0] * 18, P[1] - nn[1] * 18, P[0] + nn[0] * 22, P[1] + nn[1] * 22, { c: C.ink3, w: 0.6, dash: '2.5 2' });
  void X;
  return g.html('图 1　最小偏向角：棱镜内的光线平行于底边，入射角等于出射角');
}

// ======================= F-P 干涉仪 =======================
export function fabryPerotFig() {
  const g = new Fig(280, 150), ay = 68, x1 = 84, x2 = 124, d = x2 - x1, th = 17 * D2R, t = Math.tan(th);
  const xl = 196, f = 62, xf = xl + f;
  g.axis(10, ay, 272);
  g.rect(x1 - 9, 12, 9, 112, { c: C.glassEdge, fill: C.glass, sw: 0.9 });
  g.rect(x2, 12, 9, 112, { c: C.glassEdge, fill: C.glass, sw: 0.9 });
  g.line(x1, 12, x1, 124, { c: C.ink, w: 1.8 }).line(x2, 12, x2, 124, { c: C.ink, w: 1.8 });
  g.lens(xl, ay, 116, { label: 'L' });
  g.screen(xf, 8, 128);
  // 多次反射：每往返一次光线沿镜面下移 2d·tanθ，各透射光彼此平行，经透镜会聚于焦平面上同一点
  let y = 22; const pts = [[20, y - (x1 - 9 - 20) * t], [x1, y]];
  const P = [xf, ay + f * t];
  const outs = [];
  let x = x1;
  for (let k = 0; k < 7; k++) { x = x === x1 ? x2 : x1; y += d * t; pts.push([x, y]); if (x === x2) outs.push(y); }
  g.ray(pts.slice(0, 2), { c: C.lamp });
  g.ray(pts.slice(1), { c: C.lamp, w: 0.9, arrows: 'none' });
  outs.slice(0, 4).forEach((yo, i) => {
    const yl = yo + (xl - x2) * t;
    g.ray([[x2, yo], [xl, yl], P], { c: C.lamp, w: 1, op: 1 - i * 0.2 });
  });
  g.dot(P[0], P[1], 2);
  g.dim(x1, 136, x2, 136, '*d*', { off: -7 });
  g.text(x1 - 4, 6, '*R*', { size: 10.5, a: 'end' }).text(x2 + 4, 6, '*R*', { size: 10.5, a: 'start' });
  g.line(x1, pts[1][1], x1 + 22, pts[1][1], { c: C.ink3, w: 0.6, dash: '2.5 2' });
  g.arc(x1, pts[1][1], 16, 0, th / D2R, '*θ*', { lr: 8 });
  g.dim(xl, 142, xf, 142, '*f*', { off: -7 });
  return g.html('图 1　F-P 干涉仪的多光束干涉：透射光逐次减弱，经透镜会聚后叠加');
}

// ======================= 偏振 =======================
/** 透视画的圆形元件：中心 x，axisDeg 为主轴相对竖直方向的转角 */
function disk(g, x, cy, label, axisDeg, kind = 'pol') {
  const rx = 7, ry = 30;
  g._(`<ellipse cx="${x}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${C.glass}" stroke="${C.glassEdge}" stroke-width="0.9"/>`);
  const a = axisDeg * D2R, dx = Math.sin(a) * rx * 0.95, dy = -Math.cos(a) * ry * 0.92;
  g.line(x - dx, cy - dy, x + dx, cy + dy, { c: kind === 'pol' ? C.ink : C.laser, w: 1.3, dash: kind === 'pol' ? '' : '3 1.5' });
  g.text(x, cy + ry + 11, label, { size: 10.5 });
}
export function polarizationChain() {
  const g = new Fig(280, 120), ay = 52;
  g.axis(8, ay, 272);
  g.rect(8, ay - 10, 26, 20, { c: C.ink, fill: '#e6ebe8' });
  g.text(21, ay + 22, '光源', { size: 10 });
  g.ray([[34, ay], [262, ay]], { c: C.laser, w: 1.2 });
  disk(g, 82, ay, 'P₁', 0);
  disk(g, 152, ay, '波片', 35, 'wave');
  disk(g, 222, ay, 'P₂', 70);
  g.rect(254, ay - 9, 18, 18, { c: C.ink, fill: '#3a4741' });
  g.text(263, ay + 22, '探头', { size: 10 });
  // 各段光的偏振态（迎着光看）
  const mark = (x, kind) => {
    const y = ay - 40;
    if (kind === 'n') { for (const a of [0, 60, 120]) { const dx = Math.cos(a * D2R) * 6, dy = Math.sin(a * D2R) * 6; g.line(x - dx, y - dy, x + dx, y + dy, { c: C.ink2, w: 0.8 }); } }
    else if (kind === 'l') g.line(x, y - 7, x, y + 7, { c: C.ink2, w: 1 });
    else if (kind === 'e') g._(`<ellipse cx="${x}" cy="${y}" rx="4" ry="7.5" transform="rotate(20 ${x} ${y})" fill="none" stroke="${C.ink2}" stroke-width="1"/>`);
    else if (kind === 'l2') g.line(x - Math.sin(70 * D2R) * 7, y + Math.cos(70 * D2R) * 7, x + Math.sin(70 * D2R) * 7, y - Math.cos(70 * D2R) * 7, { c: C.ink2, w: 1 });
  };
  mark(54, 'n'); mark(117, 'l'); mark(187, 'e'); mark(242, 'l2');
  g.text(54, ay - 26, '部分偏振', { size: 8.5, c: C.ink3 }).text(117, ay - 26, '线偏振', { size: 8.5, c: C.ink3 }).text(187, ay - 26, '椭圆偏振', { size: 8.5, c: C.ink3 }).text(244, ay - 26, '线偏振', { size: 8.5, c: C.ink3 });
  g.text(140, 112, '实线：偏振片透振方向　虚线：波片快轴', { size: 9.5, c: C.ink2 });
  return g.html('图 2　偏振实验光路：起偏器 P₁、波片、检偏器 P₂');
}
export function malusFig() {
  const g = new Fig(200, 132), O = [70, 112], th = 38, L = 92;
  g.line(O[0], O[1], O[0], 12, { c: C.ink, w: 1 }).text(O[0], 6, 'P₂ 透振方向', { size: 10 });
  const E = [O[0] + L * Math.sin(th * D2R), O[1] - L * Math.cos(th * D2R)];
  g.arrow(O[0], O[1], E[0], E[1], { c: C.laser, w: 1.6, s: 6 });
  g.text(E[0] + 10, E[1], '*E*₀', { size: 11, a: 'start' });
  const Pj = [O[0], O[1] - L * Math.cos(th * D2R)];
  g.line(E[0], E[1], Pj[0], Pj[1], { c: C.ink3, w: 0.7, dash: '2.5 2' });
  g.arrow(O[0] - 0.01, O[1], Pj[0], Pj[1], { c: C.ink, w: 2.2, s: 6 });
  g.text(O[0] - 8, (O[1] + Pj[1]) / 2, '*E*₀ cos*θ*', { size: 10.5, a: 'end' });
  g.arc(O[0], O[1], 30, -90, -90 + th, '*θ*', { lr: 8 });
  return g.html('图 1　马吕斯定律：只有沿透振方向的分量 E₀cosθ 能通过', { max: 260 });
}

// ======================= 布儒斯特角 =======================
export function brewsterFig() {
  const g = new Fig(280, 156), O = [140, 76], n = 1.52, thB = Math.atan(n), tht = Math.asin(Math.sin(thB) / n), L = 76;
  g.rect(14, O[1], 252, 60, { c: 'none', fill: C.glass });
  g.line(14, O[1], 266, O[1], { c: C.glassEdge, w: 1.2 });
  g.text(250, O[1] + 12, '玻璃 *n*', { size: 10.5, a: 'end' }).text(250, O[1] - 12, '空气', { size: 10.5, a: 'end' });
  g.line(O[0], 8, O[0], 136, { c: C.ink3, w: 0.6, dash: '4 2' });
  const I = [O[0] - L * Math.sin(thB), O[1] - L * Math.cos(thB)];
  const Rf = [O[0] + L * Math.sin(thB), O[1] - L * Math.cos(thB)];
  const T = [O[0] + 70 * Math.sin(tht), O[1] + 70 * Math.cos(tht)];
  g.ray([I, O], { c: C.laser, w: 1.3 }).ray([O, Rf], { c: C.laser, w: 1.3 }).ray([O, T], { c: C.laser, w: 1.3 });
  g.arc(O[0], O[1], 30, -90 - thB / D2R, -90, '*θ*_{B}', { lr: 10 });
  g.arc(O[0], O[1], 30, 90 - tht / D2R, 90, '*θ*_{t}', { lr: 10 });
  // 反射光与折射光垂直
  const ar = Math.atan2(Rf[1] - O[1], Rf[0] - O[0]) / D2R;
  g.rightAngle(O[0], O[1], ar, 9);
  // 偏振记号：入射光含 s、p 两种分量；反射光只有 s；折射光以 p 为主
  const along = (P, Q, k) => [P[0] + (Q[0] - P[0]) * k, P[1] + (Q[1] - P[1]) * k];
  const aI = Math.atan2(O[1] - I[1], O[0] - I[0]);
  for (const k of [0.3, 0.55]) { const p = along(I, O, k); g.polMark(p[0], p[1], aI, 'p'); }
  for (const k of [0.42, 0.67]) { const p = along(I, O, k); g.polMark(p[0], p[1], aI, 's'); }
  for (const k of [0.4, 0.6, 0.8]) { const p = along(O, Rf, k); g.polMark(p[0], p[1], 0, 's'); }
  const aT = Math.atan2(T[1] - O[1], T[0] - O[0]);
  for (const k of [0.45, 0.75]) { const p = along(O, T, k); g.polMark(p[0], p[1], aT, 'p'); }
  g.text(Rf[0] + 8, Rf[1] - 14, '反射光：只有 s 分量', { size: 9.5, a: 'end' });
  g.text(30, 150, '↕ p 分量（在入射面内）　• s 分量（垂直入射面）', { size: 9.5, a: 'start', c: C.ink2 });
  return g.html('图 1　布儒斯特角：θ<sub>B</sub> + θ<sub>t</sub> = 90°，反射光为振动垂直于入射面的线偏振光');
}

// ======================= 旋光仪 =======================
export function polarimeterChain() {
  const g = new Fig(280, 108), ay = 46;
  g.axis(6, ay, 274);
  g.rect(6, ay - 11, 22, 22, { c: C.ink, fill: '#e6ebe8' }); g.text(17, ay + 22, '钠灯', { size: 10 });
  g.ray([[28, ay], [266, ay]], { c: C.lamp, w: 1.2 });
  g.lens(42, ay, 32);
  g.rect(62, ay - 14, 7, 28, { c: C.glassEdge, fill: C.glass }); g.text(65, ay + 25, '起偏镜', { size: 9.5 });
  g.rect(78, ay - 14, 4, 28, { c: C.glassEdge, fill: '#c9dbe2' }); g.text(82, ay - 22, '半荫片', { size: 9.5 });
  g.rect(100, ay - 10, 92, 20, { c: C.ink, fill: 'rgba(226,236,228,.7)' });
  g.text(146, ay + 22, '样品管（长 *l*）', { size: 9.5 });
  g.rect(206, ay - 14, 7, 28, { c: C.glassEdge, fill: C.glass }); g.text(209, ay + 25, '检偏镜', { size: 9.5 });
  g.lens(236, ay, 30); g.lens(256, ay, 22);
  g.text(248, ay - 22, '望远镜', { size: 9.5 });
  g.text(140, 100, '振动面通过样品后转过 *φ* = [*α*] *l* *c*', { size: 10 });
  return g.html('图 1　旋光仪光路');
}
export function halfShadeFig() {
  const g = new Fig(250, 132), O = [62, 72], R = 48, t = 12; // 半荫角 θ（图中放大）
  g.circle(O[0], O[1], R, { c: C.ink, w: 1 });
  g.line(O[0] - R * 0.33, O[1] - R * 0.94, O[0] - R * 0.33, O[1] + R * 0.94, { c: C.ink3, w: 0.7 });
  g.line(O[0] + R * 0.33, O[1] - R * 0.94, O[0] + R * 0.33, O[1] + R * 0.94, { c: C.ink3, w: 0.7 });
  const dir = (deg) => [Math.sin(deg * D2R), -Math.cos(deg * D2R)];
  const P = dir(-t), Pp = dir(t), L = 42;
  g.line(O[0] - P[0] * L, O[1] - P[1] * L, O[0] + P[0] * L, O[1] + P[1] * L, { c: C.lamp, w: 1.4 });
  g.line(O[0] - Pp[0] * L, O[1] - Pp[1] * L, O[0] + Pp[0] * L, O[1] + Pp[1] * L, { c: C.lamp, w: 1.4, dash: '4 2' });
  g.line(O[0] - 58, O[1], O[0] + 58, O[1], { c: C.ink, w: 1.1 });
  g.arc(O[0], O[1], 30, -90 - t, -90 + t, '', {});
  g.text(O[0], O[1] - R - 9, '2*θ*', { size: 10.5 });
  g.text(O[0] - P[0] * L + 3, O[1] - P[1] * L + 10, 'OP', { size: 9.5, a: 'start' });
  g.text(O[0] - Pp[0] * L - 3, O[1] - Pp[1] * L + 10, 'OP′', { size: 9.5, a: 'end' });
  g.text(O[0] + 62, O[1], 'AA', { size: 9.5, a: 'start' });
  g.text(136, 26, 'OP：两侧的振动方向', { size: 9.5, a: 'start' }).text(136, 42, 'OP′：中间（虚线）', { size: 9.5, a: 'start' });
  g.text(136, 58, 'AA：检偏镜透振方向', { size: 9.5, a: 'start' });
  return g.html('图 2　三分视场：AA 垂直于 OP、OP′ 的角平分线时，三部分一样暗', { max: 340 });
}

// ======================= 阿贝成像 =======================
export function abbeFig() {
  const g = new Fig(280, 160), ay = 80, xo = 26, f = 50, u = 75, xl = xo + u, v = (u * f) / (u - f), xf = xl + f, xi = xl + v;
  const tq = 0.34; // 一级衍射角的正切
  g.axis(6, ay, 274);
  for (const y of [ay - 34, ay - 12, ay + 12, ay + 34]) g.ray([[4, y], [xo, y]], { c: C.laser, w: 0.8 });
  g.line(xo, ay - 40, xo, ay + 40, { c: C.ink, w: 2 });
  for (let y = ay - 38; y <= ay + 38; y += 4) g.line(xo - 2, y, xo + 2, y, { c: C.ink, w: 0.6 });
  g.text(xo, ay + 52, '物（光栅）', { size: 10 });
  g.lens(xl, ay, 116, { label: 'L', below: true });
  g.line(xf, 18, xf, 142, { c: C.ink3, w: 0.7, dash: '3 2' }); g.text(xf, 150, '频谱面', { size: 10 });
  g.line(xi, 18, xi, 142, { c: C.ink, w: 2 }); g.text(xi, 150, '像面', { size: 10 });
  // 物上两点各画 0、±1 级：同一级的光会聚于频谱面上同一点，同一物点的光会聚于像面上同一点
  for (const [yo, op] of [[ay - 22, 1], [ay + 22, 0.55]]) {
    const yi = ay - ((yo - ay) * v) / u;
    for (const k of [-1, 0, 1]) {
      const s = -k * tq, yl = yo + s * u; // +1 级向上
      g.ray([[xo, yo], [xl, yl], [xi, yi]], { c: C.laser, w: 0.9, op, arrows: k === 0 ? 'mid' : 'none' });
    }
  }
  for (const k of [-2, -1, 0, 1, 2]) g.dot(xf, ay + f * tq * k, k === 0 ? 2.6 : 2.1);
  g.text(xf + 6, ay - f * tq + 1, '+1', { size: 9, a: 'start', c: C.ink2 }).text(xf + 6, ay + 1, '0', { size: 9, a: 'start', c: C.ink2 }).text(xf + 6, ay + f * tq + 1, '−1', { size: 9, a: 'start', c: C.ink2 });
  g.dim(xl, 10, xf, 10, '*f*', { off: -6 });
  return g.html('图 1　阿贝成像：同一衍射级会聚于频谱面上同一点，再在像面上相干叠加成像');
}

// ======================= 全息照相 =======================
export function holoFig() {
  const g = new Fig(280, 184);
  const yL = 164, BS = [62, yL], M1 = [62, 34], E1 = [96, 34], O = [150, 34], M2 = [250, yL], E2 = [250, 132], H = [200, 98];
  g.rect(8, yL - 7, 32, 14, { c: C.ink, fill: '#e6ebe8' }); g.text(24, yL - 15, '激光器', { size: 9.5 });
  g.ray([[40, yL], BS], { c: C.laser });
  g.plate(BS[0] - 8, BS[1] + 8, BS[0] + 8, BS[1] - 8, 3); g.text(BS[0] + 2, yL + 14, '分束镜', { size: 9.5 });
  // 物光：分束镜 → M₁ → 扩束镜 → 物体 → 干板
  g.ray([BS, M1, E1], { c: C.laser });
  g.mirror(M1[0] - 9, M1[1] + 9, M1[0] + 9, M1[1] - 9, { side: -1 }); g.text(M1[0] - 14, M1[1] - 8, 'M₁', { size: 10 });
  g.lens(E1[0], E1[1], 14); g.text(E1[0], E1[1] - 14, '扩束镜', { size: 9.5 });
  g.poly([E1, [O[0] - 9, O[1] - 13], [O[0] - 9, O[1] + 13]], { close: true, c: 'none', fill: 'rgba(196,30,58,.12)' });
  g.rect(O[0] - 9, O[1] - 12, 20, 24, { c: C.ink, fill: '#cfc6b6' }); g.text(O[0] + 1, O[1] - 20, '物体', { size: 9.5 });
  g.poly([[O[0] - 4, O[1] + 12], [O[0] + 11, O[1] + 4], [H[0] + 9, H[1] - 9], [H[0] - 9, H[1] + 9]], { close: true, c: 'none', fill: 'rgba(196,30,58,.12)' });
  g.ray([[O[0] + 4, O[1] + 12], [H[0] - 2, H[1] - 2]], { c: C.laser, w: 1, dash: '4 2' });
  g.text(160, 80, '物光 *O*', { size: 9.5, a: 'end' });
  // 参考光：分束镜 → M₂ → 扩束镜 → 干板
  g.ray([BS, M2, E2], { c: C.laser });
  g.mirror(M2[0] - 9, M2[1] - 9, M2[0] + 9, M2[1] + 9, { side: 1 }); g.text(M2[0] + 4, M2[1] + 14, 'M₂', { size: 10 });
  g.lens(E2[0], E2[1], 14, {});
  g.poly([E2, [H[0] + 9, H[1] - 9], [H[0] - 9, H[1] + 9]], { close: true, c: 'none', fill: 'rgba(196,30,58,.12)' });
  g.ray([E2, [H[0] + 2, H[1] + 2]], { c: C.laser, w: 1, dash: '4 2' });
  g.text(232, 122, '参考光 *R*', { size: 9.5, a: 'end' });
  g.plate(H[0] - 11, H[1] + 11, H[0] + 11, H[1] - 11, 3.5, { fill: '#5a5047', c: C.ink }); g.text(H[0] + 12, H[1] - 18, '干板 H', { size: 9.5, a: 'start' });
  return g.html('图 1　全息照相记录光路（俯视）：物光与参考光在干板上干涉');
}

// ======================= 超声光栅 =======================
export function ultrasonicFig() {
  const g = new Fig(280, 164), ay = 80, x0 = 64, x1 = 122, xl = 192, f = 60, xf = xl + f, tq = 0.2;
  g.axis(6, ay, 274);
  g.ray([[8, ay], [x0, ay]], { c: C.laser });
  // 液槽与驻波：折射率随 y 周期变化（周期 Λ）
  g.rect(x0, 22, x1 - x0, 116, { c: C.ink, fill: 'rgba(214,228,236,.6)' });
  const Lam = 9;
  for (let y = 26; y < 136; y += Lam) g.rect(x0 + 1, y, x1 - x0 - 2, Lam / 2, { c: 'none', fill: 'rgba(80,110,130,.18)' });
  g.rect(x0 + 6, 12, x1 - x0 - 12, 10, { c: C.ink, fill: '#3a4741' });
  g.text((x0 + x1) / 2, 6, '压电晶片', { size: 9.5 });
  g.dim(x1 + 7, 26, x1 + 7, 26 + Lam, '', { c: C.ink2 }); g.text(x1 + 14, 30, '*Λ*', { size: 11, a: 'start' });
  g.lens(xl, ay, 120, { label: 'L', below: true });
  g.screen(xf, 14, 146);
  for (const k of [-2, -1, 0, 1, 2]) {
    const s = -k * tq, yl = ay + s * (xl - (x0 + x1) / 2), yf = ay + f * s;
    g.ray([[(x0 + x1) / 2, ay], [xl, yl], [xf, yf]], { c: C.laser, w: 1, op: [0.35, 0.7, 1, 0.7, 0.35][k + 2], arrows: k === 0 ? 'mid' : 'none' });
    g.dot(xf, yf, 2.2 - Math.abs(k) * 0.4);
    g.text(xf + 7, yf, k > 0 ? '+' + k : String(k).replace('-', '−'), { size: 9, a: 'start', c: C.ink2 });
  }
  g.dim(xf - 8, ay, xf - 8, ay + f * tq, '', { c: C.ink2 }); g.text(xf - 13, ay + (f * tq) / 2, 'Δ*x*', { size: 10.5, a: 'end', bg: true });
  g.dim(xl, 156, xf, 156, '*f*', { off: -7 });
  return g.html('图 1　超声光栅：液体中的驻波相当于相位光栅，透镜焦平面上出现各级衍射光点');
}

// ======================= 望远镜 =======================
export function keplerFig() {
  const g = new Fig(280, 150), ay = 70, xo = 40, f1 = 128, f2 = 42, xe = xo + f1 + f2, s0 = 0.1;
  g.axis(6, ay, 274);
  g.lens(xo, ay, 96, { label: '物镜', below: true });
  g.lens(xe, ay, 64, { label: '目镜', below: true });
  g.dot(xo + f1, ay, 1.8).text(xo + f1, ay - 8, 'F₁′(F₂)', { size: 9.5 });
  for (const h of [-36, -14, 8]) {
    const y0 = ay + h, s1 = thin(h, s0, f1), y1 = y0 + s1 * (xe - xo), s2 = thin(y1 - ay, s1, f2);
    g.ray([[xo - 34, y0 - 34 * s0], [xo, y0], [xe, y1], [xe + 56, y1 + 56 * s2]], { c: C.lamp, w: 1 });
  }
  // 主光线（过物镜光心）
  g.ray([[xo - 34, ay - 34 * s0], [xo, ay], [xo + f1, ay + f1 * s0]], { c: C.ink3, w: 0.8, dash: '3 2', arrows: 'none' });
  // 中间实像位于公共焦平面上
  const yImg = ay + f1 * s0;
  g.line(xo + f1, ay, xo + f1, yImg, { c: C.ink2, w: 1.3 }); g.head(xo + f1, yImg, Math.PI / 2, { c: C.ink2, s: 5 });
  g.arc(xo, ay, 46, 0, Math.atan(s0) / D2R, '', {});
  g.text(xo + 52, ay + 9, '*ω*', { size: 11 });
  g.dim(xo, 136, xo + f1, 136, '*f*₁', { off: -7 }).dim(xo + f1, 136, xe, 136, '*f*₂', { off: -7 });
  // 出射平行光与光轴的夹角 ω′：过目镜光心作平行于出射光的辅助线
  const sOut = -s0 * f1 / f2;
  g.line(xe, ay, xe + 56, ay + 56 * sOut, { c: C.ink3, w: 0.7, dash: '3 2' });
  g.arc(xe, ay, 40, Math.atan(sOut) / D2R, 0, '', {});
  g.text(xe + 48, ay - 6, '*ω*′', { size: 11, a: 'start' });
  return g.html('图 1　开普勒望远镜：物镜的像方焦点与目镜的物方焦点重合，Γ = f₁/f₂');
}

// ======================= 光电效应 =======================
export function photoelectricFig() {
  const g = new Fig(280, 160), ay = 48;
  g.rect(8, ay - 16, 34, 32, { c: C.ink, fill: '#e6ebe8' }); g.text(25, ay + 26, '汞灯', { size: 10 });
  g.ray([[42, ay], [196, ay]], { c: C.lamp, w: 1.4 });
  g.rect(78, ay - 14, 6, 28, { c: C.glassEdge, fill: '#c6d9b8' }); g.text(81, ay + 24, '滤色片', { size: 9.5 });
  g.slitPlate(110, ay - 20, ay + 20, [[ay - 5, ay + 5]]); g.text(110, ay + 28, '光阑', { size: 9.5 });
  // 光电管：阴极 K（半圆柱面）与阳极 A（细丝）
  g.circle(210, ay, 24, { c: C.glassEdge, w: 1, fill: 'rgba(220,232,236,.55)' });
  g.path(`M222,${ay - 15}A16,16 0 0 1 222,${ay + 15}`, { c: C.ink, w: 2.4 });
  g.line(204, ay - 10, 204, ay + 10, { c: C.ink, w: 1.4 });
  g.text(232, ay - 22, 'K', { size: 10.5 }).text(194, ay - 14, 'A', { size: 10.5 });
  // 电路：K、A 之间加反向电压（A 接负），微电流计串联
  const yb = 128;
  g.line(204, ay + 10, 204, ay + 28).line(204, ay + 28, 150, ay + 28).line(150, ay + 28, 150, yb);
  g.line(238, ay, 262, ay).line(262, ay, 262, yb);
  g.circle(262, 96, 11, { c: C.ink, fill: '#fff' }); g.text(262, 96, 'μA', { size: 9 });
  g.line(150, yb, 186, yb).line(214, yb, 262, yb);
  g.line(188, yb - 9, 188, yb + 9, { w: 1.2 }); g.line(194, yb - 5, 194, yb + 5, { w: 2.4 });
  g.line(200, yb - 9, 200, yb + 9, { w: 1.2 }); g.line(206, yb - 5, 206, yb + 5, { w: 2.4 });
  g.line(194, yb, 200, yb);
  g.arrow(178, yb + 14, 214, yb - 14, { c: C.ink2, w: 0.8, s: 4.5 });
  g.text(197, yb + 20, '可调电压 *U*', { size: 9.5 });
  g.text(150 - 8, yb - 8, '−', { size: 12, a: 'end' }).text(262 + 14, yb - 8, '+', { size: 12, a: 'start' });
  g.text(60, 100, '反向电压：', { size: 9.5, c: C.ink2 }).text(60, 114, 'A 接负、K 接正', { size: 9.5, c: C.ink2 });
  return g.html('图 1　光电效应实验装置：反向电压增大到 U<sub>a</sub> 时光电流降为零');
}
