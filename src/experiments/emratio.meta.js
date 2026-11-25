// EMRatioExperiment 的目录信息与缩略图
export const meta = {
  id: 'emratio',
  part: '近代物理',
  title: '电子荷质比的测定',
  subtitle: '精细射束管 · 亥姆霍兹线圈 · 1/r–I 作图消去地磁场',
  tags: ['近代物理', '电磁学'],
  level: '基础',
  time: '60 min',
  color: '#2f4f6b',
  formula: String.raw`\frac em=\frac{2U}{B^2r^2},\qquad B=\left(\frac45\right)^{3/2}\frac{\mu_0NI}R`,
  measure: '电子的荷质比 e/m',
  goals: ['观察电子在均匀磁场中的圆周运动', '用精细射束管和亥姆霍兹线圈测定电子的荷质比', '学会用作图法消除地磁场等恒定系统误差', '了解亥姆霍兹线圈磁场的均匀性'],
  questions: ['电子束为什么能被看见？', '加速电压不变，线圈电流增大时轨道半径怎样变化？', '地磁场对测量有什么影响？为什么 1/r–I 图线的斜率与地磁场无关？', '如果电子的初速度与磁场不垂直，会看到什么样的轨迹？', '为什么要选较大的轨道直径？轨道太大又有什么问题？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#0b0f14'; ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, R = h * 0.42;
  ctx.strokeStyle = 'rgba(200,220,215,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
  ctx.strokeStyle = '#b26a3c'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(cx, cy, R * 1.15, R * 1.15, 0, 0, 7); ctx.stroke();
  for (const [lw, a] of [[6, 0.15], [2.5, 0.5], [1.2, 0.95]]) { ctx.strokeStyle = `rgba(120,210,255,${a})`; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(cx - R * 0.05, cy + R * 0.25, R * 0.42, 0, 7); ctx.stroke(); }
  ctx.fillStyle = '#5b6470'; ctx.fillRect(cx + R * 0.35, cy + R * 0.67, 6, 10);
}
