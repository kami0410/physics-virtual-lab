// AbbeExperiment 的目录信息与缩略图（目录页只加载这一部分，进入实验时才加载实验本体与三维引擎）

export const cm = (a, m) => (m === 0 ? a : Math.sin(Math.PI * m * a) / (Math.PI * m)); // 占空比 a 的矩形光栅第 m 级振幅

export const meta = {
  id: 'abbe',
  title: '阿贝成像与空间滤波',
  subtitle: '频谱面上的衍射光点 · 测光栅常数 · 方向滤波、低通滤波、高通滤波',
  tags: ['傅里叶光学', '空间滤波', 'FFT'],
  level: '提高',
  time: '60 min',
  color: '#3b1f4d',
  formula: String.raw`x_k=\frac{k\lambda f}{d}`,
  measure: '光栅常数 d、不同滤波器下的像',
  goals: ['理解阿贝成像原理：物的频谱在透镜后焦面上，像是频谱再一次衍射的结果', '由频谱面上衍射光点的间距测光栅常数', '用狭缝、小孔、挡光点进行方向滤波、低通滤波、高通滤波，观察像的变化，加深对空间频率的理解'],
  questions: ['频谱面上离中心越远的光点对应物的什么信息？', '用竖直狭缝滤波时，像上为什么出现水平条纹？', '网格字实验中，可变光阑开得太大或太小会怎样？', '如果入射光不是平行光，频谱面在哪里？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#0b0a10'; ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, s = Math.min(w, h) / 7;
  for (let m = -2; m <= 2; m++) for (let n = -2; n <= 2; n++) {
    const a = Math.abs(cm(0.62, m) * cm(0.62, n)) / 0.39;
    const g = ctx.createRadialGradient(cx + m * s, cy + n * s, 0, cx + m * s, cy + n * s, 2 + 5 * Math.sqrt(a));
    g.addColorStop(0, `rgba(255,90,80,${Math.min(1, 0.25 + a)})`); g.addColorStop(1, 'rgba(255,40,40,0)');
    ctx.fillStyle = g; ctx.fillRect(cx + m * s - 8, cy + n * s - 8, 16, 16);
  }
  ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1; ctx.strokeRect(cx - 3, 6, 6, h - 12);
}
