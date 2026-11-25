// ElectronBeamExperiment 的目录信息与缩略图
export const meta = {
  id: 'ebeam',
  part: '电磁学',
  title: '电子束的电偏转与磁聚焦',
  subtitle: '示波管 · 静电偏转灵敏度与加速电压 · 长螺线管纵向磁场聚焦 · 正反向励磁电流消去地磁场 · 测电子荷质比',
  tags: ['电磁学', '电子束', '荷质比'],
  level: '基础',
  time: '75 min',
  color: '#2f6b3a',
  formula: String.raw`D=\dfrac{y}{U_y}=\dfrac{l_pL}{2dU_a},\qquad \dfrac{e}{m}=\dfrac{8\pi^2U_a}{L^2B^2},\quad B=\dfrac{\mu_0NI}{\sqrt{L_s^2+D_s^2}}`,
  measure: '电偏转灵敏度、电子的荷质比 e/m',
  goals: ['了解示波管的构造和电子束的电偏转、磁聚焦原理', '测量电偏转灵敏度，验证它与加速电压成反比', '用纵向磁场聚焦法测电子的荷质比', '学会用改变电流方向的办法消除地磁场的影响'],
  questions: ['为什么偏转灵敏度与加速电压成反比？', '纵向磁场中，电子束在荧光屏上的亮线为什么一边旋转一边缩短？', '为什么所有电子不论横向速度多大，都在同一位置会聚？', '地磁场对测量有什么影响？为什么正、反向电流各测一次取平均？', '继续增大励磁电流，会出现第二次聚焦吗？它对应的电流是第一次的几倍？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#e4ebe5'; ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, R = h * 0.4;
  ctx.fillStyle = '#0c1a12'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(120,200,140,.35)'; ctx.lineWidth = 1;
  for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(cx + (k * R) / 4, cy - R * 0.95); ctx.lineTo(cx + (k * R) / 4, cy + R * 0.95); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx - R * 0.95, cy + (k * R) / 4); ctx.lineTo(cx + R * 0.95, cy + (k * R) / 4); ctx.stroke(); }
  ctx.strokeStyle = '#7dff9e'; ctx.lineWidth = 2.4;
  for (const [a, l] of [[0.0, 0.7], [0.5, 0.45], [1.0, 0.22]]) { ctx.globalAlpha = 0.35 + a * 0.6; ctx.beginPath(); ctx.moveTo(cx - Math.cos(a) * R * l, cy - Math.sin(a) * R * l); ctx.lineTo(cx + Math.cos(a) * R * l, cy + Math.sin(a) * R * l); ctx.stroke(); }
  ctx.globalAlpha = 1;
}
