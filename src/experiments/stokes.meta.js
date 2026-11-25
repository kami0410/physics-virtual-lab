// StokesExperiment 的目录信息与缩略图
export const meta = {
  id: 'stokes',
  part: '力学',
  title: '落球法测液体的黏滞系数',
  subtitle: '斯托克斯公式 · 筒壁与筒底修正 · 雷诺数 · 黏度随温度的变化',
  tags: ['力学', '流体'],
  level: '基础',
  time: '60 min',
  color: '#a16207',
  formula: String.raw`\eta=\dfrac{(\rho-\rho_0)gd^2t}{18L\left(1+2.4\dfrac dD\right)\left(1+1.6\dfrac dH\right)}`,
  measure: '蓖麻油的黏滞系数',
  goals: ['观察小球在黏滞液体中的下落运动，理解收尾速度', '用落球法测液体的黏滞系数，掌握筒壁、筒底修正的方法', '计算雷诺数，判断斯托克斯公式的适用条件', '练习用螺旋测微器、游标卡尺、秒表测量'],
  questions: ['为什么上标线不能离液面太近？', '小球为什么要沿圆筒的中心轴下落？靠近筒壁下落时测得的时间偏大还是偏小？', '小球投放前为什么要先在油中浸润？', '用大小不同的小球测得的黏度一样吗？为什么？', '实验过程中油温升高了 1 °C，对结果影响有多大？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#e8ebef'; ctx.fillRect(0, 0, w, h);
  const x = w * 0.36, wd = w * 0.28;
  ctx.fillStyle = 'rgba(200,150,40,.55)'; ctx.fillRect(x, h * 0.16, wd, h * 0.76);
  ctx.strokeStyle = '#64748b'; ctx.lineWidth = 2; ctx.strokeRect(x, h * 0.06, wd, h * 0.86);
  ctx.fillStyle = '#1f2937'; ctx.fillRect(x - 2, h * 0.3, wd + 4, 3); ctx.fillRect(x - 2, h * 0.78, wd + 4, 3);
  ctx.fillStyle = '#4b5563'; for (const [y, r] of [[0.4, 3], [0.55, 3], [0.7, 3]]) { ctx.beginPath(); ctx.arc(x + wd / 2, h * y, r, 0, 7); ctx.fill(); }
  ctx.strokeStyle = '#c41e3a'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x + wd + 8, h * 0.32); ctx.lineTo(x + wd + 8, h * 0.78); ctx.stroke();
}
