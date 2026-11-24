// UltrasonicExperiment 的目录信息与缩略图（目录页只加载这一部分，进入实验时才加载实验本体与三维引擎）
import { besselJ } from '../physics/bessel.js';

export const meta = {
  id: 'usg',
  title: '超声光栅测声速',
  subtitle: '液体中的超声驻波形成相位光栅 · 拉曼–奈斯衍射 · 由衍射光点间距求声波波长与声速',
  tags: ['声光效应', '衍射', '光具座'],
  level: '中等',
  time: '40 min',
  color: '#0e7490',
  formula: String.raw`v=\dfrac{\lambda f\,\nu}{\Delta x}`,
  measure: '液体中的声速 v',
  goals: ['了解超声光栅的形成原理和声光效应', '学会调节信号源频率使压电换能器谐振，调节超声池使光垂直入射', '用测微目镜测量衍射光点的间距，求液体中的声速'],
  questions: ['为什么只在压电晶片谐振时才能看到较多级次的衍射光点？', '超声池倾斜时衍射光点为什么不对称？', '本实验用的是驻波还是行波？对测量结果有影响吗？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#060808'; ctx.fillRect(0, 0, w, h);
  for (let k = -4; k <= 4; k++) {
    const I = besselJ(k, 2.4) ** 2, x = w / 2 + k * w * 0.1;
    const gr = ctx.createRadialGradient(x, h / 2, 0, x, h / 2, 10);
    gr.addColorStop(0, `rgba(255,70,60,${Math.min(1, I * 3)})`); gr.addColorStop(1, 'rgba(255,0,0,0)');
    ctx.fillStyle = gr; ctx.fillRect(x - 12, h / 2 - 12, 24, 24);
  }
}
