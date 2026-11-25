// SoundExperiment 的目录信息与缩略图
export const meta = {
  id: 'sound',
  part: '力学',
  title: '声速的测定',
  subtitle: '超声换能器 · 驻波共振法 · 相位比较法 · 逐差法',
  tags: ['力学', '振动与波', '示波器'],
  level: '基础',
  time: '90 min',
  color: '#0f766e',
  formula: String.raw`v=f\lambda,\qquad v_T=331.45\sqrt{1+\dfrac{t}{273.15}}\ \mathrm{m/s}`,
  measure: '空气中的声速',
  goals: ['了解压电陶瓷超声换能器的工作原理，学会调节谐振频率', '用驻波共振法和相位比较法测空气中的声速', '进一步熟悉信号发生器和示波器的使用', '用逐差法处理数据，并与理论值比较'],
  questions: ['为什么要在换能器的谐振频率下测量？', '驻波法中，接收端的振幅极大值为什么随距离增大而减小？', '相位比较法中，李萨如图形由直线变为椭圆再变为反向直线，S₂ 移动了多少距离？', '两种方法测得的波长哪个更准？为什么？', '实验时室温升高 2 °C，声速改变多少？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#e8ebef'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#475569'; ctx.fillRect(w * 0.08, h * 0.78, w * 0.84, 4);
  ctx.fillStyle = '#334155'; ctx.fillRect(w * 0.12, h * 0.42, w * 0.1, h * 0.3); ctx.fillRect(w * 0.7, h * 0.42, w * 0.1, h * 0.3);
  ctx.strokeStyle = '#0f766e'; ctx.lineWidth = 1.6; ctx.beginPath();
  for (let i = 0; i <= 80; i++) { const x = w * 0.22 + (i / 80) * w * 0.48, y = h * 0.57 + Math.sin(i * 0.47) * h * 0.12 * Math.abs(Math.cos(i * 0.0)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(15,118,110,.45)'; ctx.beginPath();
  for (let i = 0; i <= 80; i++) { const x = w * 0.22 + (i / 80) * w * 0.48, y = h * 0.57 - Math.sin(i * 0.47) * h * 0.12; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.stroke();
}
