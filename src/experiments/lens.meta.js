// LensExperiment 的目录信息与缩略图（目录页只加载这一部分，进入实验时才加载实验本体与三维引擎）

export function objectPattern() {
  // 物屏上的透光图案（“F”字 + 箭头），白色透光区域，对应 2.4cm × 2.4cm
  const c = document.createElement('canvas');
  c.width = c.height = 240;
  const g = c.getContext('2d');
  g.fillStyle = '#fff6d8';
  const u = 100 / 1; // 100 px/cm
  // F 字：高 1.6cm
  g.fillRect(70, 40, 22, 160);
  g.fillRect(70, 40, 100, 22);
  g.fillRect(70, 108, 72, 20);
  // 小箭头
  g.beginPath(); g.moveTo(190, 190); g.lineTo(190, 120); g.lineTo(178, 136); g.moveTo(190, 120); g.lineTo(202, 136);
  g.strokeStyle = '#fff6d8'; g.lineWidth = 7; g.stroke();
  return { canvas: c, sizeCm: 2.4, pxPerCm: u };
}

export const meta = {
  id: 'lens',
  title: '薄透镜焦距的测定',
  subtitle: '物距像距法 · 二次成像法（贝塞尔法） · 自准直法',
  tags: ['几何光学', '光具座', '共轴调节'],
  level: '基础',
  time: '30 min',
  color: '#a86a12',
  formula: String.raw`f=\dfrac{L^2-d^2}{4L}`,
  measure: '凸透镜焦距 f',
  goals: ['学会光学元件的共轴调节方法', '掌握物距像距法、二次成像法与自准直法测量凸透镜焦距', '理解厚透镜主面位置对测量结果的影响，学习误差分析与不确定度评定'],
  questions: ['为什么二次成像法要求物屏与像屏间距 L > 4f？', '共轴调节不好会对测量结果产生什么影响？如何利用“大像小像”判断共轴？', '实际透镜有一定厚度，用透镜中心代替主面会带来怎样的系统误差？哪种方法受影响最小？', '白光照明下，清晰像的边缘为什么带有彩色镶边？在透镜前加小光阑后像为什么更清晰、焦距测量值有何变化？'],
};

export function thumb(ctx, w, h) {
  // 像屏上的倒立“F”字像
  ctx.fillStyle = '#3a3c3a'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(0,0,0,.25)';
  for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo((i * w) / 8, 0); ctx.lineTo((i * w) / 8, h); ctx.moveTo(0, (i * h) / 8); ctx.lineTo(w, (i * h) / 8); ctx.stroke(); }
  const o = objectPattern();
  ctx.save(); ctx.filter = 'blur(1.2px)'; ctx.translate(w / 2, h / 2); ctx.rotate(Math.PI);
  ctx.drawImage(o.canvas, -w * 0.42, -h * 0.42, w * 0.84, h * 0.84); ctx.restore();
}
