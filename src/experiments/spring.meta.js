// SpringExperiment 的目录信息与缩略图
export const meta = {
  id: 'spring',
  part: '力学',
  title: '弹簧振子的研究',
  subtitle: '静态法（胡克定律）与动态法（T²–m 直线）测劲度系数 · 求弹簧的有效质量 · 光电门测周期',
  tags: ['力学', '简谐振动', '作图法'],
  level: '基础',
  time: '45 min',
  color: '#3d5a80',
  formula: String.raw`T=2\pi\sqrt{\dfrac{m+m_0}{k}},\qquad T^2=\dfrac{4\pi^2}{k}m+\dfrac{4\pi^2}{k}m_0,\quad m_0\approx\dfrac{m_s}{3}`,
  measure: '弹簧的劲度系数 k、有效质量 m₀',
  goals: ['验证胡克定律，用静态法测弹簧的劲度系数', '研究弹簧振子的周期与振子质量的关系', '用作图法由 T²–m 直线求劲度系数和弹簧的有效质量', '比较静态法和动态法的结果'],
  questions: ['为什么 T²–m 直线不过原点？截距的物理意义是什么？', '弹簧的有效质量为什么约为它本身质量的 1/3？', '测周期时为什么要测多个周期的总时间？振幅大小对周期有没有影响？', '静态法、动态法测得的劲度系数哪个更可靠？为什么？', '把弹簧剪去一半，劲度系数和有效质量各怎样变化？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#e6eaf0'; ctx.fillRect(0, 0, w, h);
  const x = w * 0.32;
  ctx.strokeStyle = '#4b5963'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(w * 0.12, h * 0.1); ctx.lineTo(w * 0.52, h * 0.1); ctx.stroke();
  ctx.strokeStyle = '#3d5a80'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x, h * 0.1);
  for (let i = 0; i <= 14; i++) ctx.lineTo(x + (i % 2 ? 8 : -8), h * (0.14 + i * 0.03));
  ctx.lineTo(x, h * 0.6); ctx.stroke();
  ctx.fillStyle = '#6b7785'; ctx.fillRect(x - 12, h * 0.6, 24, h * 0.18);
  const x0 = w * 0.6, y0 = h * 0.86;
  ctx.strokeStyle = '#4b5963'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, h * 0.2); ctx.lineTo(x0, y0); ctx.lineTo(w * 0.95, y0); ctx.stroke();
  ctx.strokeStyle = '#3d5a80'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0 - 4, y0 - h * 0.1); ctx.lineTo(w * 0.93, h * 0.24); ctx.stroke();
  ctx.fillStyle = '#3d5a80'; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(x0 + (i + 1) * w * 0.058, y0 - h * 0.1 - (i + 1) * h * 0.105, 2.6, 0, 7); ctx.fill(); }
}
