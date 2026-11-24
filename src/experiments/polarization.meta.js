// PolarizationExperiment 的目录信息与缩略图（目录页只加载这一部分，进入实验时才加载实验本体与三维引擎）

export const meta = {
  id: 'polar',
  title: '光的偏振',
  subtitle: '马吕斯定律 · 半波片使振动面转过 2θ · 四分之一波片产生椭圆和圆偏振光',
  tags: ['波动光学', '偏振', '穆勒矩阵'],
  level: '基础',
  time: '40 min',
  color: '#13306b',
  formula: String.raw`I=I_0\cos^2\theta`,
  measure: '光强 I(θ)、消光角',
  goals: ['观察光的偏振现象，掌握起偏与检偏的方法', '验证马吕斯定律', '了解 1/2 波片、1/4 波片的作用，学会产生和检验椭圆偏振光、圆偏振光'],
  questions: ['如何用一块偏振片判断一束光是线偏振光、自然光还是部分偏振光？', '1/2 波片转过 θ 角时，出射线偏振光的振动面为什么转过 2θ？', '仅用检偏器能否区分圆偏振光和自然光？还需要什么元件？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,.12)';
  ctx.beginPath(); ctx.moveTo(10, h - 22); ctx.lineTo(w - 8, h - 22); ctx.stroke();
  ctx.strokeStyle = '#e0435a'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i <= w - 20; i++) { const t = (i / (w - 20)) * 2 * Math.PI; const y = h - 22 - Math.cos(t) ** 2 * (h - 60); i ? ctx.lineTo(10 + i, y) : ctx.moveTo(10 + i, y); }
  ctx.stroke();
  ctx.strokeStyle = '#9fb4e8'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(w / 2, 30, 18, 8, -0.5, 0, Math.PI * 2); ctx.stroke();
}
