// GmExperiment 的目录信息与缩略图
export const meta = {
  id: 'gm',
  part: '近代物理',
  title: 'G-M 计数器与放射性统计',
  subtitle: '坪曲线与工作电压 · 计数的泊松统计 · 双源法测死时间 · β 射线在铝中的吸收',
  tags: ['近代物理', '核物理', '统计'],
  level: '基础',
  time: '75 min',
  color: '#4a4a2c',
  formula: String.raw`P(N)=\dfrac{\bar N^N}{N!}e^{-\bar N},\quad n=\dfrac{m}{1-m\tau},\quad n=n_0e^{-\mu_m x_m}`,
  measure: '坪曲线（起始电压、坪长、坪斜）、计数的均值与方差、死时间 τ、β 射线在铝中的质量吸收系数',
  goals: ['了解 G-M 计数管的工作原理，测量坪曲线并选择工作电压', '验证放射性计数服从泊松分布', '用双源法测量计数系统的死时间', '测量 β 射线在铝中的吸收，求质量吸收系数，并作死时间修正'],
  questions: ['G-M 管的工作电压为什么选在坪区的前三分之一到二分之一处？', '计数 N 的标准差为什么约等于 √N？要使相对误差小于 1%，至少要计多少个数？', '计数率高时为什么要做死时间修正？双源法的思路是什么？', 'β 射线是连续谱，为什么在铝中的吸收仍近似服从指数规律？', '本底计数从哪里来？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#ebe9df'; ctx.fillRect(0, 0, w, h);
  const x0 = w * 0.1, y0 = h * 0.86;
  ctx.strokeStyle = '#6b6a4a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, h * 0.1); ctx.lineTo(x0, y0); ctx.lineTo(w * 0.94, y0); ctx.stroke();
  ctx.strokeStyle = '#4a4a2c'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i <= 60; i++) { const v = i / 60, x = x0 + v * w * 0.82; const e = v < 0.2 ? 0 : (1 / (1 + Math.exp(-(v - 0.27) * 60))) * (1 + 0.15 * Math.max(0, v - 0.32)) * (v > 0.85 ? Math.exp((v - 0.85) * 18) : 1); const y = y0 - Math.min(0.8, e * 0.5) * h; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
  ctx.stroke();
  ctx.fillStyle = '#b3261e'; for (let k = 0; k < 12; k++) { const x = w * (0.5 + k * 0.035), hh = Math.exp(-((k - 5) ** 2) / 8) * h * 0.22; ctx.fillRect(x, h * 0.36 - hh, w * 0.028, hh); }
}
