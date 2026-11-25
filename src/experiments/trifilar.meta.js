// TrifilarExperiment 的目录信息与缩略图
export const meta = {
  id: 'trifilar',
  part: '力学',
  title: '三线摆测转动惯量',
  subtitle: '扭转振动周期 · 圆环的转动惯量 · 验证平行轴定理 · 秒表计时',
  tags: ['力学', '刚体转动'],
  level: '基础',
  time: '90 min',
  color: '#7c5c2e',
  formula: String.raw`I=\dfrac{MgRr}{4\pi^2H}T^2,\qquad I=I_C+md^2`,
  measure: '下盘、圆环与圆柱的转动惯量',
  goals: ['学会用三线摆测定物体的转动惯量', '用累积放大法测周期，掌握秒表的使用和计时误差的控制', '验证转动惯量的叠加性和平行轴定理', '学会用游标卡尺、米尺测长度，并评定测量不确定度'],
  questions: ['为什么扭转角不能太大？太大时测得的周期偏大还是偏小？', '为什么要轻轻转动上盘使下盘起振，而不直接扭动下盘？', '测周期时为什么从平衡位置开始和停止计时？为什么要测 30 个周期而不是 1 个？', '下盘加上待测物体后周期一定变大吗？为什么？', '如何用三线摆验证平行轴定理？两个圆柱为什么要对称放置？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#e8ebef'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#3b4250'; ctx.fillRect(w * 0.12, h * 0.06, w * 0.06, h * 0.88); ctx.fillRect(w * 0.12, h * 0.06, w * 0.5, h * 0.06);
  ctx.fillStyle = '#6b7280'; ctx.beginPath(); ctx.ellipse(w * 0.55, h * 0.18, w * 0.12, h * 0.04, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = '#475569'; ctx.lineWidth = 1;
  for (const [a, b] of [[0.45, 0.25], [0.6, 0.85], [0.65, 0.45]]) { ctx.beginPath(); ctx.moveTo(w * (0.55 + (a - 0.55) * 0.5), h * 0.19); ctx.lineTo(w * a + (b - 0.5) * w * 0.4, h * 0.72); ctx.stroke(); }
  ctx.fillStyle = '#8a6a2a'; ctx.beginPath(); ctx.ellipse(w * 0.55, h * 0.74, w * 0.3, h * 0.09, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#b08d47'; ctx.beginPath(); ctx.ellipse(w * 0.55, h * 0.71, w * 0.3, h * 0.09, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = '#3f3f46'; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(w * 0.55, h * 0.69, w * 0.17, h * 0.05, 0, 0, 7); ctx.stroke();
  ctx.strokeStyle = '#c41e3a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(w * 0.55, h * 0.71, w * 0.36, 0.2, 0.9); ctx.stroke();
}
