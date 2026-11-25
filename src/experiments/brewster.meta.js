// BrewsterExperiment 的目录信息与缩略图（目录页只加载这一部分，进入实验时才加载实验本体与三维引擎）
import { fresnelR } from '../physics/polarization.js';

export const D2R = Math.PI / 180;

export const meta = {
  id: 'brewster',
  title: '布儒斯特角与菲涅耳公式',
  subtitle: '反射光的偏振 · 消光法测布儒斯特角 · 由 tan θ_B = n 求折射率 · R_p、R_s 随入射角的变化',
  tags: ['波动光学', '偏振', '菲涅耳公式'],
  level: '中等',
  time: '45 min',
  color: '#13306b',
  formula: String.raw`\tan\theta_B=n`,
  measure: '布儒斯特角 θ_B、玻璃折射率 n',
  goals: ['观察反射光的偏振现象，理解布儒斯特定律', '用自准直法确定入射角零点，用消光法测布儒斯特角，求玻璃折射率', '测量 p 光、s 光的反射率随入射角的变化，与菲涅耳公式比较'],
  questions: ['为什么在布儒斯特角下反射光只有 s 分量？', '偏振片透振方向不准时，测得的“消光角”会有什么变化？如何用布儒斯特角反过来校准偏振片？', '样品背面为什么要磨砂涂黑？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, w, h);
  const n = 1.52, X = (t) => 10 + (t / 90) * (w - 20), Y = (r) => h - 10 - r * (h - 20) * 1.6;
  for (const [k, c] of [['s', '#7aa7ff'], ['p', '#ff5a6e']]) {
    ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.beginPath();
    for (let t = 0; t <= 89; t++) { const r = fresnelR(t * D2R, n)[k]; t ? ctx.lineTo(X(t), Y(Math.min(0.55, r))) : ctx.moveTo(X(t), Y(r)); }
    ctx.stroke();
  }
}
