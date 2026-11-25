// AirTrackExperiment 的目录信息与缩略图
export const meta = {
  id: 'airtrack',
  part: '力学',
  title: '气垫导轨上的碰撞',
  subtitle: '静态调平 · 光电门测速 · 弹性与完全非弹性碰撞 · 验证动量守恒',
  tags: ['力学', '动量守恒'],
  level: '基础',
  time: '90 min',
  color: '#4e6f86',
  formula: String.raw`m_1v_{10}=m_1v_1'+m_2v_2'`,
  measure: '碰撞前后的总动量与总动能',
  goals: ['学会调平气垫导轨，用光电门和数字毫秒计测速度', '在弹性碰撞和完全非弹性碰撞中验证动量守恒定律', '比较两种碰撞的动能损失，求弹簧圈的恢复系数', '分析气膜阻力、导轨不水平对结果的影响'],
  questions: ['导轨没调平时，测得的 p′/p₀ 是偏大还是偏小？和倾斜方向有什么关系？', '为什么碰撞要发生在两个光电门之间，而且尽量靠近光电门 2？', '挡光片的 Δx 取大一些好还是小一些好？', '完全非弹性碰撞中损失的动能到哪里去了？m₁ = m₂ 时损失多少？', '弹性碰撞 m₁ = m₂ 时，为什么滑块 1 碰后没有完全停下？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#e8ebef'; ctx.fillRect(0, 0, w, h);
  const y = h * 0.62;
  ctx.fillStyle = '#b8c0cc'; ctx.beginPath(); ctx.moveTo(w * 0.04, y); ctx.lineTo(w * 0.96, y); ctx.lineTo(w * 0.96, y + h * 0.08); ctx.lineTo(w * 0.04, y + h * 0.08); ctx.fill();
  const glider = (x, c) => { ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x - w * 0.12, y); ctx.lineTo(x - w * 0.1, y - h * 0.12); ctx.lineTo(x + w * 0.1, y - h * 0.12); ctx.lineTo(x + w * 0.12, y); ctx.fill(); ctx.fillStyle = '#1d2832'; ctx.fillRect(x - 2, y - h * 0.26, 4, h * 0.14); };
  glider(w * 0.3, '#8a5a44'); glider(w * 0.62, '#4e6f86');
  ctx.strokeStyle = '#2d3a46'; ctx.lineWidth = 3;
  for (const x of [w * 0.2, w * 0.8]) { ctx.beginPath(); ctx.moveTo(x, y + h * 0.1); ctx.lineTo(x, y - h * 0.3); ctx.lineTo(x + w * 0.04, y - h * 0.3); ctx.stroke(); }
  ctx.strokeStyle = '#c41e3a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(w * 0.42, y - h * 0.2); ctx.lineTo(w * 0.5, y - h * 0.2); ctx.lineTo(w * 0.47, y - h * 0.24); ctx.stroke();
}
