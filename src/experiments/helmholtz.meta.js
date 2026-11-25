// HelmholtzExperiment 的目录信息与缩略图
export const meta = {
  id: 'helmholtz',
  title: '圆线圈与亥姆霍兹线圈的磁场',
  subtitle: '霍尔探头特斯拉计 · 轴线磁场分布 · 磁场叠加原理 · 线圈间距与均匀区',
  tags: ['电学', '磁学', '毕奥–萨伐尔定律'],
  level: '基础',
  time: '50 min',
  color: '#b45309',
  formula: String.raw`B(x)=\dfrac{\mu_0NIR^2}{2(R^2+x^2)^{3/2}},\quad B_O=\left(\dfrac45\right)^{3/2}\dfrac{\mu_0NI}{R}`,
  measure: '单个圆线圈和两线圈在不同间距下的轴线磁场分布',
  goals: ['测量载流圆线圈轴线上的磁场分布，与毕奥–萨伐尔定律的计算比较', '验证磁场叠加原理，测亥姆霍兹线圈（间距等于半径）的磁场，了解均匀区', '比较线圈间距 d = R/2、R、2R 时轴线磁场的变化'],
  questions: ['为什么每次测量前都要在线圈断电时把特斯拉计调零？调零消除了哪些影响？', '两线圈串联时，如果其中一个接反，中心的磁场会怎样？', '为什么间距等于半径时中心附近的磁场最均匀？', '测得的单线圈中心磁场与 μ₀NI/2R 有微小差别，可能的原因有哪些？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#f3efe6'; ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h * 0.46;
  ctx.strokeStyle = '#b86b2b'; ctx.lineWidth = 7;
  for (const dx of [-w * 0.13, w * 0.13]) { ctx.beginPath(); ctx.ellipse(cx + dx, cy, w * 0.05, h * 0.32, 0, 0, 7); ctx.stroke(); }
  ctx.strokeStyle = '#1d2832'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(w * 0.06, cy); ctx.lineTo(w * 0.94, cy); ctx.stroke();
  ctx.strokeStyle = '#b45309'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i <= 100; i++) { const x = (i / 100 - 0.5) * 2.6; const f = (z) => 1 / Math.pow(1 + z * z, 1.5); const b = f(x - 0.5) + f(x + 0.5); const px = cx + x * w * 0.26, py = h * 0.95 - b * h * 0.28; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
  ctx.stroke();
}
