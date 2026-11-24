// NewtonExperiment 的目录信息与缩略图（目录页只加载这一部分，进入实验时才加载实验本体与三维引擎）
import { newtonIntensity } from '../physics/interference.js';

export const LINES = [[589.0e-6, 1], [589.6e-6, 0.5]]; // 钠 D 双线 (mm)

export const meta = {
  id: 'newton',
  title: '牛顿环测透镜曲率半径',
  subtitle: '等厚干涉 · 读数显微镜 · 消除空程 · 逐差法与图线法',
  tags: ['波动光学', '等厚干涉', '读数显微镜'],
  level: '基础',
  time: '35 min',
  color: '#a86a12',
  formula: String.raw`R=\dfrac{D_m^2-D_n^2}{4(m-n)\lambda}`,
  measure: '平凸透镜曲率半径 R',
  goals: ['观察等厚干涉现象，理解牛顿环的形成原理', '学会读数显微镜的调节与使用，掌握消除空程误差的方法', '用逐差法和图线法处理数据，测量平凸透镜的曲率半径'],
  questions: ['为什么不用暗环半径 r 而用直径 D 计算？为什么用 D_m²−D_n² 而不直接用 D_m²？', '测量时为什么必须使鼓轮始终沿同一方向转动？', '牛顿环中心为什么常常不是一个理想的暗点？这对结果有影响吗？'],
};

export function thumb(ctx, w, h) {
  const img = ctx.createImageData(w, h);
  const s = 3.2 / w;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = (x - w / 2) * s, Y = (y - h / 2) * s;
    const I = newtonIntensity(X * X + Y * Y, 1000, 0, LINES);
    const i = (y * w + x) * 4;
    img.data[i] = 255 * Math.min(1, I * 1.1); img.data[i + 1] = 200 * Math.min(1, I * 1.1); img.data[i + 2] = 40 * I; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
