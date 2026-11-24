// 指针式电表表盘（2D canvas）：电路实验的三维贴图、放大观察窗和目录缩略图共用

/** 指针转角（弧度，0 为竖直） */
export function dialAngle(theta, center) { const span = Math.PI / 2; return center ? theta * span : (theta - 0.5) * span; }

/** 画表盘（3D 贴图与放大观察窗共用） */
export function drawDialFace(ctx, x0, y0, w, h, { kind, divs, center, cls, unit, theta = null, range = null, title = '' }) {
  ctx.save(); ctx.translate(x0, y0);
  ctx.fillStyle = '#f1ede2'; ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h * 0.92, R = Math.min(w * 0.46, h * 0.78);
  const span = Math.PI / 2;
  const ang = (f) => (center ? f * span : (f - 0.5) * span); // f: 满偏比例（中心零为 -0.5..0.5）
  ctx.strokeStyle = '#111'; ctx.fillStyle = '#111'; ctx.lineCap = 'butt';
  ctx.lineWidth = Math.max(1, w / 400);
  ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2 - span / 2, -Math.PI / 2 + span / 2); ctx.stroke();
  // 镜面弧带
  ctx.strokeStyle = 'rgba(150,170,185,.7)'; ctx.lineWidth = R * 0.035;
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.86, -Math.PI / 2 - span / 2, -Math.PI / 2 + span / 2); ctx.stroke();
  ctx.strokeStyle = '#111';
  const n0 = center ? -divs / 2 : 0, n1 = center ? divs / 2 : divs;
  const labStep = center ? 10 : divs % 30 === 0 ? 30 : divs / 5;
  for (let i = n0; i <= n1; i++) {
    const f = (center ? i / divs : i / divs), a = ang(f) - Math.PI / 2;
    const L = i % labStep === 0 ? 0.11 : i % 5 === 0 ? 0.075 : 0.045;
    ctx.lineWidth = i % 5 === 0 ? Math.max(1.2, w / 300) : Math.max(0.6, w / 700);
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.lineTo(cx + Math.cos(a) * R * (1 + L), cy + Math.sin(a) * R * (1 + L)); ctx.stroke();
    if (i % labStep === 0) {
      ctx.font = `${Math.round(R * 0.1)}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i), cx + Math.cos(a) * R * 1.2, cy + Math.sin(a) * R * 1.2);
    }
  }
  ctx.font = `bold ${Math.round(R * 0.16)}px Arial`; ctx.textAlign = 'center';
  ctx.fillText(unit, cx, cy - R * 0.42);
  ctx.font = `${Math.round(R * 0.085)}px Arial`;
  ctx.fillText(center ? '检流计' : `${cls}  ⊓  ⊥`, cx, cy - R * 0.25);
  if (range) { ctx.font = `${Math.round(R * 0.09)}px "Microsoft YaHei"`; ctx.fillStyle = '#7a1d1d'; ctx.fillText(range, cx, cy - R * 0.1); }
  if (title) { ctx.font = `${Math.round(R * 0.09)}px "Microsoft YaHei"`; ctx.fillStyle = '#333'; ctx.textAlign = 'left'; ctx.fillText(title, w * 0.03, h * 0.08); }
  if (theta != null) {
    const a = ang(theta) - Math.PI / 2;
    ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(1.2, w / 260);
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 0.08, cy + Math.sin(a) * R * 0.08); ctx.lineTo(cx + Math.cos(a) * R * 1.08, cy + Math.sin(a) * R * 1.08); ctx.stroke();
    ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(cx, cy, R * 0.05, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
