// StringWaveExperiment 的目录信息与缩略图
export const meta = {
  id: 'stringwave',
  part: '力学',
  title: '弦线上的驻波',
  subtitle: '共振法测波长 · 验证 v = √(T/μ) · lg λ–lg T 作图',
  tags: ['力学', '振动与波'],
  level: '基础',
  time: '60 min',
  color: '#6b5a45',
  formula: String.raw`L=n\frac\lambda2,\qquad v=f\lambda=\sqrt{\frac T\mu}`,
  measure: '弦上横波的波长、波速与线密度',
  goals: ['观察弦线上的驻波，理解共振条件 L = nλ/2', '用共振法测量弦上横波的波长和波速', '验证波速与张力的关系 v = √(T/μ)', '学会用对数坐标作图求幂指数'],
  questions: ['为什么只有在某些弦长下弦才剧烈振动？', '用 L–n 直线的斜率求 λ，比直接用 2L/n 好在哪里？', '张力增大为原来的 4 倍，同一频率下的波长怎样变化？', '驱动磁钢为什么不能放在弦的正中间附近？', '实测波速比 √(T/μ) 略大，可能的原因有哪些？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#e8ebef'; ctx.fillRect(0, 0, w, h);
  const x0 = w * 0.08, x1 = w * 0.92, y = h * 0.5, n = 3;
  ctx.fillStyle = 'rgba(80,92,104,.35)'; ctx.beginPath();
  for (let i = 0; i <= 100; i++) { const x = x0 + ((x1 - x0) * i) / 100; ctx.lineTo(x, y - h * 0.22 * Math.abs(Math.sin((n * Math.PI * i) / 100))); }
  for (let i = 100; i >= 0; i--) { const x = x0 + ((x1 - x0) * i) / 100; ctx.lineTo(x, y + h * 0.22 * Math.abs(Math.sin((n * Math.PI * i) / 100))); }
  ctx.fill();
  ctx.strokeStyle = '#1d2832'; ctx.lineWidth = 1.2; ctx.beginPath();
  for (let i = 0; i <= 100; i++) { const x = x0 + ((x1 - x0) * i) / 100; ctx.lineTo(x, y - h * 0.22 * Math.sin((n * Math.PI * i) / 100)); }
  ctx.stroke();
  ctx.fillStyle = '#4b5963';
  for (const x of [x0, x1]) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 5, y + 10); ctx.lineTo(x + 5, y + 10); ctx.fill(); }
  ctx.fillStyle = '#c41e3a'; ctx.fillRect(x0 + 6, y + 8, 5, 6);
}
