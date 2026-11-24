// SpectrometerExperiment 的目录信息与缩略图（目录页只加载这一部分，进入实验时才加载实验本体与三维引擎）
import { rgbCss } from '../physics/color.js';

export const HG = [ // 汞灯谱线 (nm, 相对强度)
  [404.66, 0.35], [435.83, 0.75], [491.60, 0.12], [546.07, 1.0], [576.96, 0.55], [579.07, 0.55], [623.44, 0.08],
];

export const meta = {
  id: 'spectro',
  title: '分光计调节与光栅衍射',
  subtitle: '自准直法 · 各半调节法 · 双游标读数消偏心差 · 测光栅常数与汞灯波长',
  tags: ['分光计', '光栅', '光谱'],
  level: '较难',
  time: '60 min',
  color: '#13306b',
  formula: String.raw`d\sin\theta_k=k\lambda`,
  measure: '光栅常数 d、汞灯谱线波长 λ',
  goals: ['了解分光计的结构，掌握“望远镜聚焦无穷远、望远镜光轴垂直仪器转轴、平行光管出射平行光”的调节方法', '观察光栅衍射光谱，理解光栅方程', '用已知波长的汞绿线测光栅常数，再测其他谱线的波长'],
  questions: ['为什么要用两个相差 180° 的游标读数？', '各半调节法中，为什么调望远镜和调载物台各消除一半偏差？', '若入射光不垂直于光栅平面，用 ±1 级衍射角的平均值测量会带来多大误差？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#050608'; ctx.fillRect(0, 0, w, h);
  for (const [nm, a] of HG) {
    const x = w * 0.12 + ((nm - 400) / 230) * w * 0.76;
    const gr = ctx.createLinearGradient(x - 3, 0, x + 3, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, rgbCss(nm, Math.min(1, a + 0.25))); gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr; ctx.fillRect(x - 3, h * 0.2, 6, h * 0.6);
  }
  ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
}
