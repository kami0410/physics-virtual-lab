// MichelsonExperiment 的目录信息与缩略图（目录页只加载这一部分，进入实验时才加载实验本体与三维引擎）
import { michelsonPattern } from '../physics/interference.js';

export const LAMBDA = 632.8e-6; // mm

export const meta = {
  id: 'michelson',
  title: '迈克尔逊干涉仪测激光波长',
  subtitle: '分振幅干涉 · 等倾干涉圆环 · 条纹“冒出/缩进”计数 · 逐差法',
  tags: ['波动光学', '干涉', '精密测长'],
  level: '中等',
  time: '40 min',
  color: '#c41e3a',
  formula: String.raw`\lambda=\dfrac{2\Delta d}{\Delta N}`,
  measure: 'He-Ne 激光波长 λ',
  goals: ['了解迈克尔逊干涉仪的结构与原理，掌握其调节方法', '观察等倾干涉条纹的特点，理解条纹“冒出”“缩进”与光程差变化的关系', '利用条纹计数测量 He-Ne 激光的波长，用逐差法处理数据'],
  questions: ['为什么转动微动手轮时必须始终沿同一方向？空程误差是如何产生的？', '等倾干涉圆环中心冒出一个条纹时，动镜 M₁ 移动了多少？', '随着 d 减小，条纹变粗还是变细？当 d→0 时会看到什么现象？'],
};

export function thumb(ctx, w, h) {
  const img = ctx.createImageData(w, h);
  michelsonPattern(img, { d: 1.1, lambda: LAMBDA, halfW: 30, beamW: 34 });
  ctx.putImageData(img, 0, 0);
}
