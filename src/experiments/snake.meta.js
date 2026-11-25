// SnakePendulumExperiment 的目录信息与缩略图
export const meta = {
  id: 'snake',
  part: '力学',
  title: '蛇摆的设计与制作',
  subtitle: '15 个单摆 · 按“Γ 内依次多摆一次”设计摆长 · 蛇形、分列与重新对齐 · 设计性实验',
  tags: ['振动', '单摆', '设计性'],
  level: '设计',
  time: '60 min',
  color: '#2f6b4f',
  formula: String.raw`N_k=N_0+k,\quad T_k=\dfrac{\Gamma}{N_k},\quad L_k=g\left(\dfrac{\Gamma}{2\pi N_k}\right)^2`,
  measure: '各摆的设计摆长与实测周期、分列与重新对齐的时刻',
  goals: ['用单摆周期公式设计一组摆长，使它们在同一时间 Γ 内依次多摆一次', '学会精确调节和测量摆长，用秒表校核周期', '观察蛇形、分列、重新对齐等图样，理解它们出现的时刻 Γ/m', '分析摆长误差、摆角和阻尼对图样的影响'],
  questions: ['为什么在 t = Γ/2 时摆球恰好分成两列？Γ/3 时呢？', '摆长误差 1 mm，对最长和最短的摆，Γ 时刻的相位误差各是多少？', '摆角从 5° 加大到 15°，重新对齐的时刻怎样变化？各摆的变化相同吗？', '为什么要用两根线（双线摆）悬挂每个摆球？', '如果想让 Γ = 30 s，摆长应该怎样设计？受到什么限制？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#e6ece7'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#4b5963'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(w * 0.06, h * 0.12); ctx.lineTo(w * 0.94, h * 0.12); ctx.stroke();
  for (let k = 0; k < 15; k++) {
    const x0 = w * 0.1 + (k * w * 0.8) / 14, L = h * (0.75 - k * 0.028), th = 0.35 * Math.sin(k * 0.55);
    const x = x0 + L * Math.sin(th) * 0.6, y = h * 0.12 + L * Math.cos(th) * 0.9;
    ctx.strokeStyle = '#8a9ba3'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, h * 0.12); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillStyle = '#2f6b4f'; ctx.beginPath(); ctx.arc(x, y, w * 0.022, 0, 7); ctx.fill();
  }
}
