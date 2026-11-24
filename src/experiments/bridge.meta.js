// BridgeExperiment 的目录信息与缩略图（目录页只加载这一部分，进入实验时才加载实验本体与三维引擎）

export const meta = {
  id: 'bridge',
  title: '惠斯通电桥测电阻',
  subtitle: '电桥平衡 · 保护电阻与跃接法 · 交换法消除比例臂误差 · 电桥灵敏度',
  tags: ['电学', '比较法', '电桥'],
  level: '基础',
  time: '45 min',
  color: '#0f766e',
  formula: String.raw`R_x=\dfrac{R_1}{R_2}R_0,\quad R_x=\sqrt{R_0R_0'}`,
  measure: '两个中值电阻的阻值、电桥灵敏度',
  goals: ['理解惠斯通电桥的平衡原理，学会自组电桥', '掌握检流计的保护方法（保护电阻、跃接）和电桥平衡的调节', '用交换法消除比例臂误差，测量电桥灵敏度并估算其引起的误差'],
  questions: ['电桥平衡时，电源电压的波动对测量结果有没有影响？为什么？', '为什么调平衡时先接入较大的保护电阻？最后为什么要把它减到零？', '交换法为什么能消除比例臂 R₁、R₂ 不相等带来的误差？', '如何提高电桥的灵敏度？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#f1ede2'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#1d2832'; ctx.lineWidth = 2;
  const cx = w / 2, cy = h / 2, r = w * 0.32;
  ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.closePath(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
  ctx.fillStyle = '#f1ede2'; ctx.beginPath(); ctx.arc(cx, cy, 9, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#c41e3a'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center'; ctx.fillText('G', cx, cy + 4);
}
