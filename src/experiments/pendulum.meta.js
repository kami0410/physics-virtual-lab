// PendulumExperiment 的目录信息与缩略图
export const meta = {
  id: 'pendulum',
  part: '力学',
  title: '单摆测重力加速度',
  subtitle: '改变摆长作 T²–L 图 · 累积放大法计时 · 摆角对周期的影响',
  tags: ['力学', '振动'],
  level: '基础',
  time: '60 min',
  color: '#4b5a53',
  formula: String.raw`T=2\pi\sqrt{\dfrac Lg},\qquad g=\dfrac{4\pi^2}{k}\ \ (T^2=kL)`,
  measure: '当地的重力加速度',
  goals: ['用单摆测定重力加速度', '学会用累积放大法测周期，掌握秒表计时的要点', '用作图法（T²–L 直线）处理数据，理解它消除系统误差的作用', '观察摆角对周期的影响，理解小角近似的适用范围'],
  questions: ['为什么要在摆球经过最低点时开表、停表？', '摆长应该量到哪里？漏加摆球半径会使 g 偏大还是偏小？用 T²–L 图的斜率求 g 还受影响吗？', '为什么测 30 个周期而不是 1 个？', '摆角为 15° 时，用小角公式算出的 g 偏大还是偏小？大约差多少？', '摆线的质量和弹性伸长对结果有什么影响？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#e8ebef'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#3b4250'; ctx.fillRect(w * 0.14, h * 0.08, w * 0.05, h * 0.86); ctx.fillRect(w * 0.14, h * 0.08, w * 0.46, h * 0.05);
  const ox = w * 0.55, oy = h * 0.13, L = h * 0.62;
  ctx.strokeStyle = '#94a3b8'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox, oy + L + 10); ctx.stroke(); ctx.setLineDash([]);
  for (const [a, al] of [[-0.22, 0.25], [-0.11, 0.4], [0.2, 1]]) {
    const bx = ox + L * Math.sin(a), by = oy + L * Math.cos(a);
    ctx.globalAlpha = al; ctx.strokeStyle = '#1d2832'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(bx, by); ctx.stroke();
    ctx.fillStyle = '#6b7280'; ctx.beginPath(); ctx.arc(bx, by, w * 0.05, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#c41e3a'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(ox, oy, L * 0.35, Math.PI / 2 - 0.2, Math.PI / 2 + 0.22); ctx.stroke();
}
