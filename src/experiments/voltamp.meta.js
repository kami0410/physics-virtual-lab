// VoltAmpExperiment 的目录信息与缩略图（目录页只加载这一部分，进入实验时才加载实验本体与三维引擎）
import { drawDialFace } from '../core/dial.js';

export const meta = {
  id: 'voltamp',
  title: '伏安法测电阻',
  subtitle: '分压电路 · 电流表内接与外接 · 系统误差修正 · 二极管正向伏安特性',
  tags: ['电学', '电表', '基本测量'],
  level: '基础',
  time: '45 min',
  color: '#b45309',
  formula: String.raw`R_{内}=\dfrac{U}{I}-R_A,\quad R_{外}=\dfrac{U}{I-U/R_V}`,
  measure: '两个电阻的阻值、二极管的伏安特性',
  goals: ['学会用分压电路给待测元件供电，掌握电表量程的选择和读数', '理解电流表内接、外接引起的系统误差，学会选择接法并修正', '测绘二极管的正向伏安特性曲线'],
  questions: ['什么情况下用内接法误差小？什么情况下用外接法？临界条件是什么？', '分压电路在接通电源前，滑动端应放在什么位置？为什么？', '测二极管正向特性时为什么要串联限流电阻？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#f1ede2'; ctx.fillRect(0, 0, w, h);
  drawDialFace(ctx, w * 0.05, h * 0.08, w * 0.9, h * 0.84, { kind: 'A', divs: 150, cls: 0.5, unit: 'mA', theta: 0.68 });
}
