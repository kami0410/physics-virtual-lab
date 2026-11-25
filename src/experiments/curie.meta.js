// CurieExperiment 的目录信息与缩略图
export const meta = {
  id: 'curie',
  part: '电磁学',
  title: '铁磁材料居里温度的测定',
  subtitle: '铁氧体环形样品 · 交流感应法测次级电压随温度的变化 · 升温、降温两条曲线 · 切线法求居里温度',
  tags: ['电磁学', '铁磁性', '相变', '温度测量'],
  level: '基础',
  time: '60 min',
  color: '#5b3a6b',
  formula: String.raw`U_2\propto\mu_i(T),\qquad M_s(T)\to0\ \ (T\to T_C)`,
  measure: '铁氧体样品的居里温度 T_C',
  goals: ['了解铁磁性物质在居里点由铁磁性转变为顺磁性的现象', '学习用交流感应法测量磁导率随温度的变化', '学会用切线法由 U–T 曲线确定居里温度', '分析升温、降温测量时样品温度滞后带来的系统误差'],
  questions: ['为什么温度升到居里点附近时次级电压会急剧下降？', '升温测得的居里温度为什么偏高，降温测得的为什么偏低？怎样减小这一误差？', '为什么要取曲线最陡一段的切线与温度轴的交点作为居里温度？', '初级线圈的电流太大，对测量有什么影响？', '居里温度以上次级电压为什么不为零？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#ece6ef'; ctx.fillRect(0, 0, w, h);
  const x0 = w * 0.12, y0 = h * 0.86, x1 = w * 0.92, y1 = h * 0.12;
  ctx.strokeStyle = '#4b5963'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();
  const f = (u) => (u < 0.72 ? 0.85 - 0.25 * u ** 2 - 0.9 * Math.max(0, u - 0.45) ** 2 * 2 : Math.max(0.03, 0.62 - (u - 0.72) * 4.2));
  ctx.strokeStyle = '#5b3a6b'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i <= 80; i++) { const u = i / 80, x = x0 + u * (x1 - x0), y = y0 - f(u) * (y0 - y1); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.stroke();
  ctx.setLineDash([4, 3]); ctx.strokeStyle = '#a0522d'; ctx.lineWidth = 1.2; ctx.beginPath();
  ctx.moveTo(x0 + 0.6 * (x1 - x0), y0 - 1.12 * (y0 - y1) * 0.9 + 6); ctx.lineTo(x0 + 0.88 * (x1 - x0), y0); ctx.stroke(); ctx.setLineDash([]);
}
