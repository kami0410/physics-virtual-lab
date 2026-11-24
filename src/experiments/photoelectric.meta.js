// PhotoelectricExperiment 的目录信息与缩略图（目录页只加载这一部分，进入实验时才加载实验本体与三维引擎）
import { rgbCss } from '../physics/color.js';

export const H = 6.62607e-34, E = 1.602177e-19, C = 2.99792e8;
export const FILTERS = [365.0, 404.7, 435.8, 546.1, 577.0]; // 滤色片中心波长 nm（汞灯谱线）
export const SPEC = { 365.0: 1.0, 404.7: 0.55, 435.8: 0.9, 546.1: 0.55, 577.0: 0.22 }; // 汞灯谱线强度 × 阴极量子效率（相对）

export const meta = {
  id: 'photo',
  title: '光电效应测普朗克常数',
  subtitle: '截止电压（零电流法）· 光电管伏安特性 · 饱和光电流与入射光强',
  tags: ['近代物理', '光电效应', '量子'],
  level: '中等',
  time: '45 min',
  color: '#5b3a8c',
  formula: String.raw`eU_a=h\nu-W`,
  measure: '普朗克常数 h、逸出功 W',
  goals: ['通过实验加深对光的量子性的理解', '用零电流法测不同频率光的截止电压，由 Uₐ–ν 直线求普朗克常数', '测光电管的伏安特性曲线，研究饱和光电流与入射光强的关系'],
  questions: ['截止电压与入射光强有没有关系？与频率呢？', '阳极反向电流和暗电流会使零电流法测得的截止电压偏大还是偏小？', '为什么测截止电压时要用最小的电流量程？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#0a0a10'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.moveTo(10, h - 14); ctx.lineTo(w - 6, h - 14); ctx.moveTo(w * 0.32, 6); ctx.lineTo(w * 0.32, h - 6); ctx.stroke();
  FILTERS.forEach((nm, i) => {
    const U0 = (H * C) / (nm * 1e-9) / E - 1.58;
    ctx.strokeStyle = rgbCss(nm < 400 ? 400 : nm, 0.95); ctx.lineWidth = 1.6; ctx.beginPath();
    for (let x = 0; x <= w - 16; x++) {
      const U = -2 + (x / (w - 16)) * 8, xx = U + U0;
      const F = xx <= 0 ? 0 : U <= 0 ? 0.25 * (xx / U0) ** 2 : 0.25 + 0.75 * (1 - Math.exp(-U / 2.2));
      const y = h - 14 - F * SPEC[nm] * (h - 30);
      x ? ctx.lineTo(10 + x, y) : ctx.moveTo(10 + x, y);
    }
    ctx.stroke(); void i;
  });
}
