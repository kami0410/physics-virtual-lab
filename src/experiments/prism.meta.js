// PrismExperiment 的目录信息与缩略图（目录页只加载这一部分，进入实验时才加载实验本体与三维引擎）
import { rgbCss } from '../physics/color.js';

export const meta = {
  id: 'prism',
  title: '三棱镜折射率与色散',
  subtitle: '分光计调节 · 自准法测顶角 · 最小偏向角法测折射率 · 柯西色散公式',
  tags: ['分光计', '折射', '色散'],
  level: '较难',
  time: '60 min',
  color: '#13306b',
  formula: String.raw`n=\dfrac{\sin\frac{A+\delta_{min}}{2}}{\sin\frac A2}`,
  measure: '顶角 A、折射率 n(λ)',
  goals: ['进一步掌握分光计的调节和使用', '用自准法测三棱镜顶角', '用最小偏向角法测棱镜玻璃对汞灯各谱线的折射率，作色散曲线并拟合柯西公式'],
  questions: ['为什么要在最小偏向角位置测量？偏离最小偏向角对结果有多大影响？', '调节三棱镜光学面与望远镜光轴垂直时，为什么只能调载物台螺钉而不能再动望远镜？', '棱镜对紫光和黄光的折射率哪个大？由此说明正常色散的特点。'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#06080a'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(220,230,240,.8)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.2); ctx.lineTo(w * 0.72, h * 0.72); ctx.lineTo(w * 0.28, h * 0.72); ctx.closePath(); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.moveTo(0, h * 0.5); ctx.lineTo(w * 0.39, h * 0.46); ctx.stroke();
  [404, 436, 546, 577].forEach((nm, i) => { ctx.strokeStyle = rgbCss(nm, 0.95); ctx.beginPath(); ctx.moveTo(w * 0.61, h * 0.47); ctx.lineTo(w, h * (0.6 + i * 0.07)); ctx.stroke(); });
}
