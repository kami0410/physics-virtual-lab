// QuasiSteadyExperiment 的目录信息与缩略图
export const meta = {
  id: 'quasi',
  part: '热学',
  title: '准稳态法测导热系数和比热容',
  subtitle: '有机玻璃四块叠放 · 双加热膜恒热流 · 热电偶测温差与升温速率 · 一次实验同时得到 λ 和 c',
  tags: ['热学', '导热', '比热容', '热电偶'],
  level: '提高',
  time: '60 min',
  color: '#8c3b2e',
  formula: String.raw`\lambda=\dfrac{q_cR}{2\Delta T},\quad c=\dfrac{q_c}{\rho R\,\frac{dT}{dt}},\quad q_c=\dfrac{V^2}{2Fr}`,
  measure: '有机玻璃的导热系数 λ 和比热容 c',
  goals: ['了解准稳态法测量导热系数和比热容的原理', '学会用热电偶测温差和温升速率', '掌握判断准稳态的方法', '分析散热、加热膜热容等因素带来的系统误差'],
  questions: ['什么是准稳态？为什么加热开始后要等一段时间才能读数？', '中心面与加热面的温差为什么会趋于恒定？', '为什么要用四块样品、两片加热膜对称放置？', '保温不好会使测得的 λ 和 c 偏大还是偏小？', '加热电压加倍，准稳态的温差和升温速率各变为多少？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#efe6e2'; ctx.fillRect(0, 0, w, h);
  const x0 = w * 0.12, y0 = h * 0.86, x1 = w * 0.92;
  ctx.strokeStyle = '#4b5963'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x0, h * 0.1); ctx.lineTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();
  ctx.strokeStyle = '#8c3b2e'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i <= 50; i++) { const t = i / 50, y = y0 - h * 0.55 * (1 - Math.exp(-6 * t)); i ? ctx.lineTo(x0 + t * (x1 - x0), y) : ctx.moveTo(x0, y); }
  ctx.stroke();
  ctx.strokeStyle = '#1f4e79'; ctx.beginPath();
  for (let i = 0; i <= 50; i++) { const t = i / 50, y = y0 - h * 0.7 * (t - (1 - Math.exp(-6 * t)) / 6); i ? ctx.lineTo(x0 + t * (x1 - x0), y) : ctx.moveTo(x0, y); }
  ctx.stroke();
}
