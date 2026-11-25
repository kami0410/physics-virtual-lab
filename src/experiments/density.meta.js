// DensityExperiment 的目录信息与缩略图
export const meta = {
  id: 'density',
  part: '力学',
  title: '长度测量与固体密度',
  subtitle: '游标卡尺 · 螺旋测微器 · 电子天平 · 零点修正 · A、B 类不确定度与误差传递',
  tags: ['力学', '基本测量', '不确定度'],
  level: '基础',
  time: '60 min',
  color: '#8a5a2b',
  formula: String.raw`\rho=\dfrac{4m}{\pi(D^2-d^2)H},\quad \rho_{\text{球}}=\dfrac{6m}{\pi d^3},\quad u=\sqrt{u_A^2+u_B^2}`,
  measure: '空心铜圆柱与钢球的密度及其不确定度',
  goals: ['掌握游标卡尺、螺旋测微器的读数原理和使用方法，会读零点并修正', '会用电子天平称质量', '学会多次测量的 A 类不确定度、仪器的 B 类不确定度和合成不确定度的计算', '学会间接测量量的不确定度传递，正确表示测量结果'],
  questions: ['50 分度游标卡尺的分度值为什么是 0.02 mm？读数时要不要估读？', '螺旋测微器的零点读数为 −0.006 mm，某次读数为 9.512 mm，被测物的直径是多少？', '用螺旋测微器测钢球时为什么要用测力装置（棘轮）而不直接拧微分筒？', '空心圆柱的密度测量中，哪个直接测量量对结果的不确定度贡献最大？怎样改进？', '为什么要在不同位置、不同方向多次测量直径？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#ece8e1'; ctx.fillRect(0, 0, w, h);
  const y = h * 0.5, ppm = w / 30;
  ctx.fillStyle = '#d7dbe0'; ctx.fillRect(0, y - h * 0.28, w, h * 0.28);
  ctx.fillStyle = '#b9bfc6'; ctx.fillRect(0, y, w, h * 0.22);
  ctx.fillStyle = '#1d2832';
  for (let k = 0; k * ppm < w; k++) { const L = k % 10 === 0 ? h * 0.16 : k % 5 === 0 ? h * 0.11 : h * 0.07; ctx.fillRect(k * ppm, y - L, 1, L); }
  const x0 = w * 0.18, dv = ppm * 0.9;
  ctx.fillStyle = '#7a3b12';
  for (let j = 0; j <= 20; j++) { const L = j % 5 === 0 ? h * 0.13 : h * 0.07; ctx.fillRect(x0 + j * dv, y, 1, L); }
  ctx.fillStyle = '#8a5a2b'; ctx.beginPath(); ctx.arc(w * 0.82, h * 0.2, h * 0.11, 0, 7); ctx.fill();
}
