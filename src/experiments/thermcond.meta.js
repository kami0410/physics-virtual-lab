// ThermCondExperiment 的目录信息与缩略图
export const meta = {
  id: 'thermcond',
  part: '热学',
  title: '稳态平板法测不良导体的导热系数',
  subtitle: '傅里叶定律 · 稳态传热 · 冷却速率 · 散热面积修正',
  tags: ['热学', '传热'],
  level: '基础',
  time: '120 min',
  color: '#b45309',
  formula: String.raw`\lambda=mc\left.\dfrac{\mathrm dT}{\mathrm dt}\right|_{T_2}\dfrac{R_P+2h_P}{2R_P+2h_P}\cdot\dfrac{h_B}{\pi R_B^2(T_1-T_2)}`,
  measure: '橡胶样品的导热系数',
  goals: ['了解热传导的基本规律，理解稳态传热', '用稳态平板法测不良导体的导热系数', '学会用冷却曲线求某一温度下的冷却速率（作切线或拟合）', '分析散热条件对测量结果的影响'],
  questions: ['怎样判断系统已经达到稳态？', '为什么要在 T₂ 附近测散热盘的冷却速率？', '冷却时散热盘的上表面暴露在空气中，而稳态时上表面被样品盖住，公式里怎样修正？', '样品与铜盘接触不好（有空气隙），测得的导热系数偏大还是偏小？', '室内有风时对结果有什么影响？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#e8ebef'; ctx.fillRect(0, 0, w, h);
  const x = w * 0.18, wd = w * 0.64;
  ctx.fillStyle = '#64748b'; ctx.fillRect(x + wd * 0.2, h * 0.14, wd * 0.6, h * 0.16);
  ctx.fillStyle = '#b87333'; ctx.fillRect(x, h * 0.3, wd, h * 0.1);
  ctx.fillStyle = '#27272a'; ctx.fillRect(x, h * 0.4, wd, h * 0.1);
  ctx.fillStyle = '#b87333'; ctx.fillRect(x, h * 0.5, wd, h * 0.1);
  ctx.strokeStyle = '#475569'; ctx.lineWidth = 2; for (const f of [0.25, 0.5, 0.75]) { ctx.beginPath(); ctx.moveTo(x + wd * f, h * 0.6); ctx.lineTo(x + wd * f, h * 0.86); ctx.stroke(); }
  ctx.strokeStyle = '#c41e3a'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.47); ctx.lineTo(w * 0.5, h * 0.62); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(w * 0.47, h * 0.58); ctx.lineTo(w * 0.5, h * 0.63); ctx.lineTo(w * 0.53, h * 0.58); ctx.stroke();
}
