// SpecHeatExperiment 的目录信息与缩略图
export const meta = {
  id: 'specheat',
  part: '热学',
  title: '冷却法测金属的比热容',
  subtitle: '牛顿冷却定律 · 铜–康铜热电偶 · 以铜为标准比较铁和铝的比热容',
  tags: ['热学', '比热容', '热电偶'],
  level: '基础',
  time: '60 min',
  color: '#a0522d',
  formula: String.raw`c_2=c_1\dfrac{m_1}{m_2}\cdot\dfrac{(\Delta t)_2}{(\Delta t)_1}`,
  measure: '铁和铝在 100 °C 附近的比热容',
  goals: ['了解比较法和冷却法测比热容的原理', '学会用热电偶和数字毫伏表测温度，学会用秒表计时', '以铜为标准样品，测定铁和铝在 100 °C 附近的比热容', '分析样品形状、表面状况和环境对测量的影响'],
  questions: ['冷却法测比热容时，为什么要求各样品的形状、大小和表面状况相同？', '为什么要在同一温度区间（如 102 °C→98 °C）测冷却时间？', '冷却过程中为什么要盖上防风筒的盖子、不能对着样品呼气？', '热电偶的冷端为什么要放在冰水混合物里？', '铝的比热容比铁大得多，冷却却更快，为什么？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#ece6df'; ctx.fillRect(0, 0, w, h);
  const x0 = w * 0.12, y0 = h * 0.86, x1 = w * 0.92;
  ctx.strokeStyle = '#4b5963'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x0, h * 0.08); ctx.lineTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();
  for (const [k, c] of [[2.2, '#b87333'], [2.0, '#4b5963'], [3.0, '#8aa0b0']]) {
    ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i <= 50; i++) { const t = i / 50, x = x0 + t * (x1 - x0), y = y0 - (h * 0.72) * Math.exp(-k * t); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
  }
}
