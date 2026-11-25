// WedgeExperiment 的目录信息与缩略图（目录页只加载这一部分，进入实验时才加载实验本体与三维引擎）
import { filmIntensity } from '../physics/interference.js';

export const LINES = [[589.0e-6, 1], [589.6e-6, 0.5]];

export const meta = {
  id: 'wedge',
  title: '劈尖干涉测细丝直径',
  subtitle: '等厚干涉 · 条纹取向校正 · 逐差法求条纹间距 · 读数显微镜测劈尖长度',
  tags: ['波动光学', '等厚干涉', '读数显微镜'],
  level: '基础',
  time: '30 min',
  color: '#a86a12',
  formula: String.raw`D=\dfrac{L\lambda}{2l}`,
  measure: '细丝直径 D',
  goals: ['观察劈尖等厚干涉条纹，理解条纹间距与劈尖角的关系', '进一步练习读数显微镜的使用', '用劈尖干涉测量细丝的直径'],
  questions: ['劈尖干涉条纹为什么是平行于棱边的等间距直条纹？', '如果条纹不平行于叉丝，会给条纹间距的测量带来什么误差？', '把细丝向棱边方向移动，条纹间距如何变化？'],
};

export function thumb(ctx, w, h) {
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const I = filmIntensity(((x + 0.15 * y) / w) * 2.6e-3, LINES);
    const i = (y * w + x) * 4;
    img.data[i] = 255 * Math.min(1, I * 1.1); img.data[i + 1] = 200 * Math.min(1, I * 1.1); img.data[i + 2] = 40 * I; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
