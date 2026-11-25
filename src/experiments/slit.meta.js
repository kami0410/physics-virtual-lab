// SlitExperiment 的目录信息与缩略图（目录页只加载这一部分，进入实验时才加载实验本体与三维引擎）
import { sinc2 } from '../physics/diffraction.js';

export const LAMBDA = 632.8e-6; // mm

export const meta = {
  id: 'slit',
  title: '单缝衍射光强分布',
  subtitle: '菲涅耳—夫琅禾费衍射 · 光电探头逐点扫描 · 由暗纹间距求缝宽',
  tags: ['波动光学', '衍射', '光强测量'],
  level: '中等',
  time: '40 min',
  color: '#c41e3a',
  formula: String.raw`a\sin\theta=k\lambda`,
  measure: '单缝宽度 a',
  goals: ['观察单缝衍射现象及其随缝宽、距离的变化，理解菲涅耳衍射与夫琅禾费衍射的区别', '用光电探头逐点测量单缝衍射的相对光强分布', '由暗纹位置求单缝宽度，验证次极大的相对强度'],
  questions: ['满足什么条件时才能把单缝衍射视为夫琅禾费衍射？', '缝宽变小时，中央明纹宽度和亮度如何变化？', '光功率计量程选择不当会对测量造成什么影响？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x++) {
    const X = (x - w / 2) * 0.35;
    const I = sinc2(X, 0.1, LAMBDA, 800);
    const v = Math.pow(I, 0.35);
    const gr = ctx.createLinearGradient(0, h * 0.3, 0, h * 0.7);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, `rgba(255,${30 + 40 * v},${30 * v},${v})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr; ctx.fillRect(x, h * 0.3, 1, h * 0.4);
  }
}
