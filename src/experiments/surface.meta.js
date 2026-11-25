// SurfaceExperiment 的目录信息与缩略图
export const meta = {
  id: 'surface',
  part: '力学',
  title: '拉脱法测液体表面张力系数',
  subtitle: '力敏传感器定标 · 吊环拉膜 · 读拉脱前后的电压',
  tags: ['力学', '表面张力'],
  level: '基础',
  time: '60 min',
  color: '#2f6f8e',
  formula: String.raw`\sigma=\frac{U_1-U_2}{B\,\pi(D_1+D_2)}`,
  measure: '纯水的表面张力系数 σ',
  goals: ['掌握用砝码对硅压阻力敏传感器定标的方法', '用拉脱法测量室温下纯水的表面张力系数', '观察液膜被拉起直至断开的过程，理解拉力最大值的来源', '分析吊环不洁净、不水平对测量的影响'],
  questions: ['为什么要记录液膜被拉断前一瞬间的读数，而不是吊环刚离开液面时的读数？', '吊环不水平时，测得的 σ 偏大还是偏小？为什么？', '吊环为什么要用 NaOH 溶液清洗？手指碰过吊环会怎样？', 'U₂ 为什么要在吊环完全离开水面后读？如果吊环还有一部分浸在水里会怎样？', '水温升高时 σ 如何变化？在分子层面怎么理解？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#e8ebef'; ctx.fillRect(0, 0, w, h);
  const yS = h * 0.68, cx = w * 0.5, R = w * 0.22, yR = h * 0.46;
  ctx.fillStyle = 'rgba(120,170,200,.45)'; ctx.fillRect(0, yS, w, h - yS);
  ctx.strokeStyle = '#2f6f8e'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0, yS); ctx.lineTo(w, yS); ctx.stroke();
  ctx.fillStyle = 'rgba(150,195,220,.7)';
  for (const x of [cx - R, cx + R]) { ctx.beginPath(); ctx.moveTo(x, yR); ctx.quadraticCurveTo(x - 4, yS - 4, x - 16, yS); ctx.lineTo(x + 16, yS); ctx.quadraticCurveTo(x + 4, yS - 4, x, yR); ctx.fill(); }
  ctx.strokeStyle = '#1d2832'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx - R, yR); ctx.lineTo(cx + R, yR); ctx.stroke();
  ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(cx, h * 0.1); ctx.lineTo(cx - R, yR); ctx.moveTo(cx, h * 0.1); ctx.lineTo(cx + R, yR); ctx.stroke();
}
