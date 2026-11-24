// 测微目镜（MCU 型）的分划板与读数鼓轮：杨氏双缝、双棱镜、超声光栅共用
// 结构：固定分划板上有 0–8 mm 刻度；活动分划板上刻十字叉丝和一对竖直双线，随鼓轮横向移动。
// 读数 = 双线所指的固定刻度整毫米数 + 鼓轮读数（1 圈 1 mm，100 分格，每格 0.01 mm，估读到 0.001 mm）。

/** 圆形视场光阑：中心与半径（逻辑像素） */
export function eyeField(W, H) { return { cx: W / 2, cy: H / 2, R: Math.min(W, H) / 2 - 3 }; }

/**
 * 画分划板。pxmm：视场中每毫米的像素数；pos：活动分划板（叉丝）在固定刻度上的位置 mm；
 * blur：目镜视度偏差（D），分划板随之模糊；dark：视场背景是暗的（叉丝线条显示为微亮的轮廓）。
 */
export function drawMicroReticle(g, W, H, { pxmm, pos, blur = 0, dark = false }) {
  const { cx, cy, R } = eyeField(W, H);
  const ink = dark ? 'rgba(196,206,200,.62)' : 'rgba(12,12,10,.88)';
  const lw = 0.9; // 刻线宽度（逻辑像素，放大观察窗时按实际像素绘制，仍然很细）
  const xOf = (mm) => cx + (mm - 4) * pxmm;
  const yS = cy + R * 0.16, tick = R * 0.07; // 固定刻度的位置
  g.save();
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
  g.filter = blur > 0.08 ? `blur(${Math.min(6, blur * 3).toFixed(1)}px)` : 'none';
  g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = lw; g.lineCap = 'butt';
  // 固定刻度：整毫米长线并标数字，半毫米短线
  g.beginPath();
  for (let k = 0; k <= 16; k++) {
    const x = xOf(k / 2), L = k % 2 ? tick * 0.55 : tick;
    g.moveTo(x, yS); g.lineTo(x, yS + L);
  }
  g.moveTo(xOf(0), yS); g.lineTo(xOf(8), yS);
  g.stroke();
  g.font = `${Math.max(9, R * 0.1).toFixed(1)}px "IBM Plex Mono", Consolas, monospace`; g.textAlign = 'center'; g.textBaseline = 'top';
  for (let mm = 0; mm <= 8; mm++) g.fillText(String(mm), xOf(mm), yS + tick + 3);
  // 活动分划板：十字叉丝（竖线、横线贯穿视场）+ 竖直双线（跨在固定刻度上，用来读整毫米数）
  const x = xOf(pos), gap = Math.max(2.2, 0.06 * pxmm);
  g.beginPath();
  g.moveTo(x, cy - R); g.lineTo(x, yS - tick * 0.9);
  g.moveTo(cx - R, cy); g.lineTo(cx + R, cy);
  g.moveTo(x - gap, yS - tick * 0.7); g.lineTo(x - gap, yS + tick * 1.5);
  g.moveTo(x + gap, yS - tick * 0.7); g.lineTo(x + gap, yS + tick * 1.5);
  g.stroke();
  g.restore();
  fieldStop(g, W, H);
}

/** 视场光阑以外涂黑，边缘略有暗角 */
export function fieldStop(g, W, H) {
  const { cx, cy, R } = eyeField(W, H);
  g.save();
  const gr = g.createRadialGradient(cx, cy, R * 0.7, cx, cy, R);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.85, 'rgba(0,0,0,.28)'); gr.addColorStop(1, 'rgba(0,0,0,.8)');
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#050505';
  g.beginPath(); g.rect(0, 0, W, H); g.arc(cx, cy, R, 0, Math.PI * 2, true); g.fill('evenodd');
  g.strokeStyle = 'rgba(60,60,58,.9)'; g.lineWidth = 1.2; g.beginPath(); g.arc(cx, cy, R + 0.6, 0, Math.PI * 2); g.stroke();
  g.restore();
}

/**
 * 读数窗（逻辑尺寸 290×100）：左为视场中固定刻度与双线的放大，右为鼓轮。
 * x：叉丝读数 mm（含空程后的真实位置），assist：显示读数辅助。
 */
export function drawMicroDrum(g, x, assist) {
  g.fillStyle = '#1d2326'; g.fillRect(0, 0, 290, 100);
  const mm = Math.floor(x), d = (x - mm) * 100;
  // 左：固定刻度与双线
  const X0 = 14, PX = 13.2, Y0 = 18;
  const bg = g.createLinearGradient(0, 8, 0, 62); bg.addColorStop(0, '#f1ead6'); bg.addColorStop(1, '#ddd4bc');
  g.fillStyle = bg; g.fillRect(8, 8, 124, 54);
  g.strokeStyle = '#141414'; g.fillStyle = '#141414'; g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(X0, Y0); g.lineTo(X0 + 8 * PX, Y0);
  for (let k = 0; k <= 16; k++) { const px = X0 + (k / 2) * PX; g.moveTo(px, Y0); g.lineTo(px, Y0 + (k % 2 ? 6 : 11)); }
  g.stroke();
  g.font = '10px "IBM Plex Mono", Consolas, monospace'; g.textAlign = 'center'; g.textBaseline = 'top';
  for (let k = 0; k <= 8; k++) g.fillText(String(k), X0 + k * PX, Y0 + 14);
  const xi = X0 + x * PX;
  g.strokeStyle = '#a3132c'; g.lineWidth = 0.9;
  g.beginPath(); g.moveTo(xi - 1.8, Y0 - 7); g.lineTo(xi - 1.8, Y0 + 13); g.moveTo(xi + 1.8, Y0 - 7); g.lineTo(xi + 1.8, Y0 + 13); g.stroke();
  const DX = 150, DW = 124;
  drawDrum(g, DX, 8, DW, 54, d);
  g.fillStyle = '#cfd6d1'; g.font = '11px "Microsoft YaHei", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillText('双线所指固定刻度 / mm', 70, 78); g.fillText('鼓轮 × 0.01 mm', DX + DW / 2, 78);
  if (assist) { g.fillStyle = '#8fe3a5'; g.font = '12px "IBM Plex Mono", Consolas, monospace'; g.textAlign = 'left'; g.fillText(`${mm} + ${(d / 100).toFixed(3)} = ${x.toFixed(3)} mm`, 10, 95); }
}

/**
 * 测微鼓轮（100 分格）：圆柱面上的刻线随转角透视压缩，套筒上有读数基线。
 * (DX, DY, DW, DH)：鼓轮可见区域；d：鼓轮读数（0–100 分格，可带小数）。
 */
export function drawDrum(g, DX, DY, DW, DH, d) {
  const cy = DY + DH / 2, Rd = DH * 0.85; // 鼓轮半径取得比可见高度大，相邻刻线约 3 px，便于估读
  const cyl = g.createLinearGradient(0, DY, 0, DY + DH);
  cyl.addColorStop(0, '#6a6f73'); cyl.addColorStop(0.2, '#c9cdd0'); cyl.addColorStop(0.46, '#eff1f2'); cyl.addColorStop(0.72, '#c2c6c9'); cyl.addColorStop(1, '#5a5f63');
  g.fillStyle = cyl; g.fillRect(DX, DY, DW, DH);
  const step = (2 * Math.PI) / 100, thMax = Math.asin(Math.min(1, DH / 2 / Rd));
  g.save(); g.beginPath(); g.rect(DX, DY, DW, DH); g.clip();
  for (let k = -24; k <= 24; k++) {
    const n = Math.floor(d) + k, th = (n - d) * step;
    if (Math.abs(th) > thMax) continue;
    const y = cy + Rd * Math.sin(th), c = Math.cos(th);
    const v = ((n % 100) + 100) % 100;
    const L = v % 10 === 0 ? 30 : v % 5 === 0 ? 22 : 14;
    g.fillStyle = `rgba(14,14,14,${(0.3 + 0.7 * c).toFixed(3)})`;
    g.fillRect(DX + DW - L - 6, y - 0.45 * c, L, 0.9 * c);
    if (v % 10 === 0) {
      g.save(); g.translate(DX + DW - L - 10, y); g.scale(1, c);
      g.font = '10px "IBM Plex Mono", Consolas, monospace'; g.textAlign = 'right'; g.textBaseline = 'middle';
      g.fillText(String(v), 0, 0); g.restore();
    }
  }
  g.restore();
  g.fillStyle = '#2b3135'; g.fillRect(DX - 6, DY, 6, DH);
  g.fillStyle = '#a3132c'; g.fillRect(DX - 6, cy - 0.6, DW + 6, 1.2);
}
