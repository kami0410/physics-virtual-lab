// GeomagExperiment 的目录信息与缩略图
export const meta = {
  id: 'geomag',
  part: '电磁学',
  title: '地磁场的测量',
  subtitle: '磁阻传感器 · 亥姆霍兹线圈定标灵敏度 · 水平面与磁子午面内转动传感器 · 求地磁场水平分量、总强度和磁倾角',
  tags: ['电磁学', '传感器', '地磁场'],
  level: '基础',
  time: '60 min',
  color: '#36575e',
  formula: String.raw`U=KB\cos\theta+U_0,\quad B_\parallel=\dfrac{U_{\max}-U_{\min}}{2K},\quad B=\dfrac{B_\parallel}{\cos\beta}`,
  measure: '磁阻传感器的灵敏度 K，地磁场的水平分量、总强度与磁倾角',
  goals: ['了解磁阻传感器的工作原理', '学会用亥姆霍兹线圈的已知磁场定标传感器的灵敏度', '测量地磁场的水平分量、磁倾角和总强度', '学会用正、反两个方向的读数消除零点偏移'],
  questions: ['为什么定标时要让线圈电流正、反向各测一次？', '传感器转到哪个方向时输出最大？怎样由此确定磁子午面？', '测磁倾角时，若传感器的转动平面偏离磁子午面，测得的总强度和磁倾角偏大还是偏小？', '实验室里的钢筋、电源对测量有什么影响？', '为什么不能只读一个方向的输出就算出磁场？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#e3eaeb'; ctx.fillRect(0, 0, w, h);
  const cx = w * 0.5, cy = h * 0.52, R = h * 0.34;
  ctx.strokeStyle = '#36575e'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
  for (let a = 0; a < 360; a += 30) { const t = (a * Math.PI) / 180; ctx.beginPath(); ctx.moveTo(cx + R * 0.88 * Math.cos(t), cy + R * 0.88 * Math.sin(t)); ctx.lineTo(cx + R * Math.cos(t), cy + R * Math.sin(t)); ctx.stroke(); }
  const t = -1.15;
  ctx.fillStyle = '#b23a2a'; ctx.beginPath(); ctx.moveTo(cx + R * 0.8 * Math.cos(t), cy + R * 0.8 * Math.sin(t)); ctx.lineTo(cx + 5 * Math.cos(t + 1.57), cy + 5 * Math.sin(t + 1.57)); ctx.lineTo(cx - 5 * Math.cos(t + 1.57), cy - 5 * Math.sin(t + 1.57)); ctx.fill();
  ctx.fillStyle = '#6b7785'; ctx.beginPath(); ctx.moveTo(cx - R * 0.8 * Math.cos(t), cy - R * 0.8 * Math.sin(t)); ctx.lineTo(cx + 5 * Math.cos(t + 1.57), cy + 5 * Math.sin(t + 1.57)); ctx.lineTo(cx - 5 * Math.cos(t + 1.57), cy - 5 * Math.sin(t + 1.57)); ctx.fill();
}
