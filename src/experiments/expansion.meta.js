// ExpansionExperiment 的目录信息与缩略图
export const meta = {
  id: 'expansion',
  part: '热学',
  title: '金属线膨胀系数的测定',
  subtitle: '温控加热 · 千分表测微小伸长 · ΔL–t 作图',
  tags: ['热学', '热膨胀'],
  level: '基础',
  time: '60 min',
  color: '#8e3b2f',
  formula: String.raw`\alpha=\frac{\Delta L}{L_0\,\Delta t}`,
  measure: '金属的线膨胀系数 α',
  goals: ['测定金属棒的线膨胀系数', '学会使用千分表测量微小长度变化', '理解测温滞后对热学测量的影响，学会判断热平衡', '用作图法处理数据'],
  questions: ['为什么温度示数到了设定值，千分表指针还在走？这时读数会使 α 偏大还是偏小？', '为什么用 ΔL–t 图的斜率而不用某一组数据直接算 α？', '棒长 L₀ 只需用米尺测量，为什么不会显著影响结果的精度？', '千分表测杆为什么要预先压缩一段？', '比较铜、铝、钢的 α，说说它们在工程上的意义（如双金属片、铁轨缝隙）。'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#e8ebef'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#8e3b2f'; ctx.fillRect(w * 0.08, h * 0.42, w * 0.58, h * 0.16);
  ctx.fillStyle = '#b87333'; ctx.fillRect(w * 0.06, h * 0.47, w * 0.66, h * 0.06);
  const cx = w * 0.82, cy = h * 0.5, R = h * 0.2;
  ctx.fillStyle = '#f4f1e6'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill(); ctx.strokeStyle = '#1d2832'; ctx.lineWidth = 1.5; ctx.stroke();
  for (let k = 0; k < 20; k++) { const a = (k / 20) * 2 * Math.PI; ctx.beginPath(); ctx.moveTo(cx + R * 0.9 * Math.cos(a), cy + R * 0.9 * Math.sin(a)); ctx.lineTo(cx + R * 0.75 * Math.cos(a), cy + R * 0.75 * Math.sin(a)); ctx.lineWidth = 0.8; ctx.stroke(); }
  ctx.strokeStyle = '#c41e3a'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + R * 0.8 * Math.cos(-0.6), cy + R * 0.8 * Math.sin(-0.6)); ctx.stroke();
}
