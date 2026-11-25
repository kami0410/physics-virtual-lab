// BohrExperiment 的目录信息与缩略图
export const meta = {
  id: 'bohr',
  part: '力学',
  title: '用波尔共振仪研究受迫振动',
  subtitle: '自由振动周期 · 阻尼系数 · 幅频与相频特性 · 频闪法测相位差',
  tags: ['力学', '振动', '共振'],
  level: '基础',
  time: '90 min',
  color: '#8b5a1e',
  formula: String.raw`\theta=\dfrac{\theta_m\omega_0^2}{\sqrt{(\omega_0^2-\omega^2)^2+4\beta^2\omega^2}},\quad \varphi=\arctan\dfrac{2\beta\omega}{\omega_0^2-\omega^2}`,
  measure: '阻尼系数 β，受迫振动的幅频与相频特性曲线',
  goals: ['观察摆轮的自由振动、阻尼振动和受迫振动，认识共振现象', '测出不同振幅下的自由振动周期，由阻尼振动的振幅衰减求阻尼系数 β', '用频闪法测受迫振动与强迫力矩之间的相位差，测定幅频和相频特性曲线', '把测得的相位差与理论值比较，分析误差来源'],
  questions: ['受迫振动稳定后，它的频率由什么决定？振幅和相位差又由什么决定？', '为什么测相位差时要等振幅稳定（摆轮振幅不再变化）以后再读？', '共振时相位差是多少？振幅最大处的频率与 ω₀ 有什么关系？', '测阻尼系数和测受迫振动时，阻尼挡为什么必须相同？', '为什么要先测出不同振幅下的固有周期 T₀？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#ece8e1'; ctx.fillRect(0, 0, w, h);
  const x0 = w * 0.1, y0 = h * 0.86, x1 = w * 0.92;
  ctx.strokeStyle = '#4b5963'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x0, h * 0.08); ctx.lineTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();
  for (const [b, c] of [[0.05, '#8b5a1e'], [0.12, '#c41e3a'], [0.25, '#2f6f5f']]) {
    ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i <= 80; i++) { const r = 0.6 + (0.8 * i) / 80, A = 1 / Math.sqrt((1 - r * r) ** 2 + 4 * b * b * r * r); const x = x0 + ((x1 - x0) * i) / 80, y = y0 - Math.min(A * 0.075, 0.82) * h; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
  }
}
