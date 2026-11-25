// FranckHertzExperiment 的目录信息与缩略图
export const meta = {
  id: 'franckhertz',
  part: '近代物理',
  title: '弗兰克-赫兹实验',
  subtitle: '充氩四极管 · 电子与原子的非弹性碰撞 · 第一激发电位',
  tags: ['近代物理', '原子物理'],
  level: '综合',
  time: '90 min',
  color: '#7c3aed',
  formula: String.raw`eU_1=E_1-E_0,\qquad U_1=\overline{U_{n+1}-U_n}`,
  measure: '氩原子的第一激发电位',
  goals: ['了解弗兰克-赫兹实验的原理，验证原子能级的存在', '测量 I_A–U_G2K 曲线，求氩原子的第一激发电位', '了解灯丝电压、控制栅电压、拒斥电压对曲线的影响'],
  questions: ['为什么 I_A–U_G2K 曲线上出现一系列峰和谷？', '第一个峰的位置为什么不等于第一激发电位？', '拒斥电压 U_G2A 增大时，曲线怎样变化？', '为什么相邻峰的间距随级次略有增大？', 'U_G2K 加得过高时会发生什么？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#e8ebef'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(w * 0.1, h * 0.86); ctx.lineTo(w * 0.92, h * 0.86); ctx.moveTo(w * 0.1, h * 0.86); ctx.lineTo(w * 0.1, h * 0.1); ctx.stroke();
  ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i <= 100; i++) { const u = i / 100, x = w * 0.1 + u * w * 0.8, ph = (u * 5.2) % 1, n = Math.floor(u * 5.2); const y = h * 0.86 - h * (0.12 + 0.11 * n) * (ph < 0.75 ? ph / 0.75 : (1 - ph) / 0.25 * 0.85 + 0.15) - h * 0.05 * n; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.stroke();
}
