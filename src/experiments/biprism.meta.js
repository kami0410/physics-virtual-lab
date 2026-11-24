// BiprismExperiment 的目录信息与缩略图（目录页只加载这一部分，进入实验时才加载实验本体与三维引擎）

export const meta = {
  id: 'biprism',
  title: '双棱镜干涉测钠光波长',
  subtitle: '分波前干涉 · 狭缝宽度与取向对条纹衬比度的影响 · 二次成像法测虚光源间距',
  tags: ['波动光学', '分波前干涉', '光具座'],
  level: '中等',
  time: '45 min',
  color: '#a86a12',
  formula: String.raw`\lambda=\dfrac{d}{D}\,\Delta x`,
  measure: '钠光波长 λ',
  goals: ['观察双棱镜干涉现象，理解分波前干涉的原理', '理解光源宽度、狭缝与棱脊平行度对条纹衬比度（空间相干性）的影响', '用测微目镜测条纹间距，用二次成像法测两虚光源间距，求钠光波长'],
  questions: ['为什么狭缝必须足够窄、且与双棱镜棱脊平行，才能看到清晰的干涉条纹？', '用二次成像法测虚光源间距时，为什么要求狭缝到测微目镜的距离大于透镜焦距的 4 倍？', '增大狭缝到双棱镜的距离，条纹间距和条纹区宽度如何变化？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#0b0906'; ctx.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x++) {
    const env = Math.exp(-(((x - w / 2) / (w * 0.32)) ** 6));
    const I = env * (0.5 + 0.5 * Math.cos((x - w / 2) * 0.55));
    ctx.fillStyle = `rgba(255,${Math.round(190 * I)},${Math.round(40 * I)},${I})`; ctx.fillRect(x, h * 0.12, 1, h * 0.76);
  }
}
