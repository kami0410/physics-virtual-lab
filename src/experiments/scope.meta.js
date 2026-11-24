// ScopeExperiment 的目录信息与缩略图（目录页只加载这一部分，进入实验时才加载实验本体与三维引擎）

export const meta = {
  id: 'scope',
  title: '自组望远镜和显微镜',
  subtitle: '用薄透镜组装开普勒望远镜和显微镜 · 调焦与出瞳 · 比较法测视角放大率',
  tags: ['几何光学', '光学仪器', '光具座'],
  level: '基础',
  time: '45 min',
  color: '#1d4ed8',
  formula: String.raw`\Gamma=\dfrac{f_1}{f_2},\quad \Gamma\approx\dfrac{\Delta}{f_o}\cdot\dfrac{250}{f_e}`,
  measure: '望远镜、显微镜的视角放大率 Γ',
  goals: ['理解望远镜和显微镜的成像原理，学会用薄透镜组装', '理解出瞳的意义：眼睛放在出瞳处视场最大', '用比较法测量视角放大率，并与理论值比较'],
  questions: ['望远镜的物镜为什么用长焦距透镜、目镜用短焦距透镜？反过来会怎样？', '为什么眼睛离目镜太远时，看到的视场变小？', '显微镜的物镜到被观察物的距离应略大于还是略小于物镜焦距？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#0f1412'; ctx.fillRect(0, 0, w, h);
  ctx.save(); ctx.beginPath(); ctx.arc(w * 0.38, h / 2, h * 0.42, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#ece8dc'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#111';
  for (let k = -4; k <= 4; k++) { const y = h / 2 + k * h * 0.11; ctx.fillRect(w * 0.2, y, k % 2 ? w * 0.18 : w * 0.3, h * 0.012); }
  ctx.restore();
  ctx.strokeStyle = '#c41e3a'; ctx.lineWidth = 1.5;
  for (const y of [0.33, 0.67]) { ctx.beginPath(); ctx.moveTo(0, h * y); ctx.lineTo(w, h * y); ctx.stroke(); }
}
