// YoungExperiment 的目录信息与缩略图（目录页只加载这一部分，进入实验时才加载实验本体与三维引擎）

export const meta = {
  id: 'young',
  title: '杨氏双缝干涉',
  subtitle: '分波前干涉 · 光源宽度与空间相干性 · 条纹间距与 D 成正比 · 测未知双缝间距',
  tags: ['波动光学', '分波前干涉', '光具座'],
  level: '基础',
  time: '40 min',
  color: '#a86a12',
  formula: String.raw`\Delta x=\dfrac{D}{d}\,\lambda`,
  measure: '钠光波长 λ、双缝间距 d',
  goals: ['观察杨氏双缝干涉条纹，理解分波前干涉', '理解单缝（光源）宽度和取向对条纹衬比度的影响', '测量不同 D 下的条纹间距，用作图法求钠光波长，再测未知双缝的间距'],
  questions: ['去掉单缝，直接用钠灯照射双缝，还能看到干涉条纹吗？为什么？', '单缝到双缝的距离增大时，允许的最大缝宽如何变化？', '视场中条纹的亮度为什么从中央向两侧逐渐减弱？哪一级条纹可能缺失？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#0b0906'; ctx.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x++) {
    const u = (x - w / 2) * 0.05;
    const env = Math.abs(u) < 1e-6 ? 1 : (Math.sin(u) / u) ** 2;
    const I = env * (0.5 + 0.5 * Math.cos((x - w / 2) * 0.42));
    ctx.fillStyle = `rgba(255,${Math.round(190 * I)},${Math.round(40 * I)},${I})`; ctx.fillRect(x, h * 0.15, 1, h * 0.7);
  }
}
