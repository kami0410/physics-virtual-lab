// MillikanExperiment 的目录信息与缩略图
export const meta = {
  id: 'millikan',
  part: '近代物理',
  title: '密立根油滴实验',
  subtitle: '静态平衡法测油滴电荷 · 电荷量子化 · 坎宁汉修正',
  tags: ['近代物理', '电学'],
  level: '综合',
  time: '90 min',
  color: '#4b5a53',
  formula: String.raw`q=\frac{18\pi}{\sqrt{2\rho g}}\left[\frac{\eta l}{t_g\left(1+\frac b{pa}\right)}\right]^{3/2}\frac dU`,
  measure: '元电荷 e',
  goals: ['用静态（平衡）法测油滴所带的电荷', '验证电荷的量子性，测定元电荷 e', '学会选择合适的油滴、调节平衡、用秒表测匀速下落时间', '理解斯托克斯定律及坎宁汉修正的物理意义'],
  questions: ['为什么要把仪器调水平？不水平会看到什么现象？', '油滴太大或太小各有什么问题？平衡电压和下落时间多少比较合适？', '为什么油滴下落时要先让它落一段再开始计时？', '坎宁汉修正使算出的 q 变大还是变小？对大油滴、小油滴哪个影响更大？', '不借助公认值 e，怎样从一组 q 求出元电荷？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(160,200,170,.5)'; ctx.lineWidth = 1;
  for (let k = 1; k < 8; k++) { const y = (h * k) / 8; ctx.beginPath(); ctx.moveTo(w * 0.3, y); ctx.lineTo(w * 0.7, y); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(w / 2, h * 0.08); ctx.lineTo(w / 2, h * 0.92); ctx.stroke();
  ctx.strokeStyle = 'rgba(232,184,74,.9)';
  for (const y of [h * 0.25, h * 0.75]) { ctx.beginPath(); ctx.moveTo(w * 0.3, y); ctx.lineTo(w * 0.7, y); ctx.stroke(); }
  const pts = [[0.42, 0.4, 2.4], [0.58, 0.62, 1.8], [0.36, 0.7, 1.4], [0.62, 0.3, 2.0], [0.52, 0.52, 2.8]];
  ctx.fillStyle = 'rgba(235,240,255,.92)';
  for (const [x, y, r] of pts) { ctx.beginPath(); ctx.arc(w * x, h * y, r, 0, 7); ctx.fill(); }
  ctx.strokeStyle = '#c41e3a'; ctx.strokeRect(w * 0.52 - 7, h * 0.52 - 7, 14, 14);
}
