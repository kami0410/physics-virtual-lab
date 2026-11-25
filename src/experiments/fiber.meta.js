// FiberExperiment 的目录信息与缩略图
export const meta = {
  id: 'fiber',
  part: '光学',
  title: '光纤的传输特性',
  subtitle: '物镜耦合与五维调节架 · 截断法测传输损耗 · 远场法测数值孔径 · 弯曲损耗',
  tags: ['光学', '光纤', '光通信'],
  level: '提高',
  time: '75 min',
  color: '#2c5f7c',
  formula: String.raw`\eta=\dfrac{P_1}{P_0},\quad \alpha=\dfrac{10}{L}\lg\dfrac{P_1}{P_2},\quad NA=n_0\sin\theta_{\max}=\sqrt{n_1^2-n_2^2}`,
  measure: '耦合效率、传输损耗系数 α（dB/km）、数值孔径 NA、弯曲损耗',
  goals: ['了解阶跃折射率光纤的导光原理和数值孔径的意义', '掌握激光与光纤耦合的调节方法', '用截断法测光纤的传输损耗', '用远场光斑法测光纤的数值孔径', '观察弯曲半径对损耗的影响'],
  questions: ['为什么入射光的会聚角超过光纤的数值孔径就不能被传输？', '截断法为什么要求截断前后入射端的耦合状态不变？', '测数值孔径时，为什么要在两个以上的距离测光斑直径并用差值计算？', '弯曲半径越小损耗越大，为什么？', '耦合效率达不到 100% 的原因有哪些？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#e2eaef'; ctx.fillRect(0, 0, w, h);
  const y = h * 0.5;
  ctx.strokeStyle = '#9fb3c1'; ctx.lineWidth = h * 0.22; ctx.beginPath(); ctx.moveTo(w * 0.08, y); ctx.lineTo(w * 0.7, y); ctx.stroke();
  ctx.strokeStyle = '#d8e4ec'; ctx.lineWidth = h * 0.12; ctx.beginPath(); ctx.moveTo(w * 0.08, y); ctx.lineTo(w * 0.7, y); ctx.stroke();
  ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(w * 0.08, y);
  for (let i = 1; i <= 8; i++) ctx.lineTo(w * (0.08 + i * 0.0775), y + (i % 2 ? -1 : 1) * h * 0.055);
  ctx.stroke();
  ctx.fillStyle = 'rgba(192,57,43,.25)'; ctx.beginPath(); ctx.moveTo(w * 0.7, y); ctx.lineTo(w * 0.95, y - h * 0.22); ctx.lineTo(w * 0.95, y + h * 0.22); ctx.fill();
}
