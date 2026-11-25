// CalibExperiment 的目录信息与缩略图（目录页只加载这一部分，进入实验时才加载实验本体与三维引擎）
import { drawDialFace } from '../core/dial.js';

export const meta = {
  id: 'calib',
  title: '电表的改装与校准',
  subtitle: '替代法测表头内阻 · 并联分流改装电流表 · 串联分压改装电压表 · 校准曲线',
  tags: ['电学', '电表', '校准'],
  level: '基础',
  time: '60 min',
  color: '#7c3aed',
  formula: String.raw`R_s=\dfrac{R_g}{n-1},\quad R_m=\dfrac{U}{I_g}-R_g`,
  measure: '表头内阻 R_g、分流电阻 R_s、分压电阻 R_m',
  goals: ['了解磁电式表头的满偏电流和内阻，用替代法测内阻', '把 100 μA 表头改装成 1 mA 电流表和 1 V 电压表', '用标准表校准改装表，作校准曲线并确定准确度等级'],
  questions: ['替代法测内阻时，标准表的准确度会影响结果吗？什么因素会影响？', '校准时为什么要先调满偏？如果改装表读数总是偏大，应把分流电阻调大还是调小？', '校准曲线为什么画成折线而不是光滑曲线？'],
};

export function thumb(ctx, w, h) {
  drawDialFace(ctx, 0, h * 0.08, w, h * 0.84, { kind: 'A', divs: 100, cls: 1.5, unit: 'μA', theta: 0.82 });
}
