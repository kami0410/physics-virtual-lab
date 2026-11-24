// FabryPerotExperiment 的目录信息与缩略图（目录页只加载这一部分，进入实验时才加载实验本体与三维引擎）

export const meta = {
  id: 'fp',
  title: '法布里–珀罗干涉仪',
  subtitle: '多光束等倾干涉 · 两镜面平行度的调节 · 由两套圆环的重合测钠 D 双线波长差',
  tags: ['波动光学', '多光束干涉', '精细光谱'],
  level: '较难',
  time: '50 min',
  color: '#a86a12',
  formula: String.raw`\Delta\lambda=\dfrac{\lambda^2}{2\Delta d}`,
  measure: '钠 D 双线波长差 Δλ',
  goals: ['了解法布里–珀罗干涉仪的结构，理解多光束干涉条纹细锐的原因', '学会用“移动眼睛看圆环是否涨缩”的方法调节两镜面平行', '观察钠 D 双线两套圆环的重合与错开，测量其波长差'],
  questions: ['与迈克尔逊干涉仪相比，F-P 干涉仪的条纹为什么细得多？条纹的细锐程度由什么决定？', '调平行时，眼睛向上移动看到圆环从中心冒出，说明哪一侧的间距较大？', '为什么相邻两次“重合”之间 d 的变化量与 Δλ 成反比？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#080604'; ctx.fillRect(0, 0, w, h);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r2 = ((x - w / 2) ** 2 + (y - h / 2) ** 2) / (w * w);
    const d1 = 2 * Math.PI * (r2 * 30), d2 = 2 * Math.PI * (r2 * 30 + 0.35);
    const I = 1 / (1 + 80 * Math.sin(d1) ** 2) + 0.6 / (1 + 80 * Math.sin(d2) ** 2);
    const k = (y * w + x) * 4; img.data[k] = 255 * Math.min(1, I); img.data[k + 1] = 180 * Math.min(1, I); img.data[k + 2] = 30 * I; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
