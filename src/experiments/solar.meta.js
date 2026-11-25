// SolarCellExperiment 的目录信息与缩略图
export const meta = {
  id: 'solar',
  part: '电磁学',
  title: '太阳能电池的基本特性',
  subtitle: '暗伏安特性与二极管理想因子 · 光照输出特性与最大功率点 · 填充因子与转换效率 · 开路电压、短路电流与光强',
  tags: ['电学', '半导体', '新能源'],
  level: '基础',
  time: '75 min',
  color: '#1f4e79',
  formula: String.raw`I=I_L-I_0\left[e^{\frac{q(U+IR_s)}{nkT}}-1\right]-\dfrac{U+IR_s}{R_{sh}},\quad FF=\dfrac{P_m}{U_{oc}I_{sc}},\quad \eta=\dfrac{P_m}{EA}`,
  measure: '理想因子 n、最大输出功率、填充因子、转换效率、短路电流和开路电压随光强的变化',
  goals: ['了解太阳能电池的工作原理和等效电路', '测量无光照时的正向伏安特性，求二极管的理想因子和反向饱和电流', '测量一定光照下的输出伏安特性，求最大输出功率、最佳负载、填充因子和转换效率', '研究短路电流和开路电压与光照强度的关系'],
  questions: ['太阳能电池无光照时相当于什么器件？有光照时为什么能对外输出电能？', '为什么短路电流与光强成正比，而开路电压与光强的对数成正比？', '负载电阻多大时输出功率最大？它与电池的什么性质有关？', '串联电阻和并联电阻分别怎样影响填充因子？', '测短路电流时，电流表的内阻会带来什么误差？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#e4e9ef'; ctx.fillRect(0, 0, w, h);
  const x0 = w * 0.12, y0 = h * 0.86, x1 = w * 0.92, y1 = h * 0.12;
  ctx.strokeStyle = '#4b5963'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();
  ctx.strokeStyle = '#1f4e79'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i <= 60; i++) { const u = i / 60, I = 1 - Math.expm1(u * 14) / Math.expm1(14), x = x0 + u * (x1 - x0) * 0.92, y = y0 - I * (y0 - y1) * 0.85; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.stroke();
  ctx.fillStyle = 'rgba(31,78,121,.18)'; ctx.fillRect(x0, y0 - (y0 - y1) * 0.85 * 0.93, (x1 - x0) * 0.92 * 0.82, (y0 - y1) * 0.85 * 0.93);
}
