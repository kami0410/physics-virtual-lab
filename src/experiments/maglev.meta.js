// MaglevExperiment 的目录信息与缩略图
export const meta = {
  id: 'maglev',
  part: '电磁学',
  title: '电磁混合磁悬浮',
  subtitle: '永磁偏置的电磁吸力 · 零功率悬浮 · 由闭环振荡频率测负刚度与电流刚度',
  tags: ['电磁学', '磁路', '自动控制'],
  level: '提高',
  time: '80 min',
  color: '#36454f',
  formula: String.raw`F=\dfrac{\mu_0AN^2(i+i_0)^2}{(2g+\delta)^2},\quad \omega_n^2=\dfrac{k_iK_p-k_x}{m}`,
  measure: '永磁体等效电流 i₀、等效气隙 δ、零功率悬浮间隙、负刚度 k_x 与电流刚度 k_i',
  goals: ['了解永磁与电磁混合悬浮的磁路和吸力规律', '测量电磁吸力与线圈电流、气隙的关系，求永磁体的等效磁动势和等效气隙', '实现稳定悬浮，观察零功率控制下悬浮间隙随负载的变化', '测量不同比例增益下的闭环振荡频率，求负刚度和电流刚度，并与静态测量比较'],
  questions: ['为什么吸引式磁悬浮在没有控制时一定不稳定？', '比例增益低于多少时无法稳定悬浮？与 k_x/k_i 有什么关系？', '零功率控制下，增加负载后浮子为什么会上移？', '混合悬浮比纯电磁悬浮省电的原因是什么？', '微分增益起什么作用？去掉它会怎样？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#e4e8ea'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#4b5560'; ctx.fillRect(w * 0.28, h * 0.12, w * 0.44, h * 0.12); ctx.fillRect(w * 0.28, h * 0.24, w * 0.08, h * 0.22); ctx.fillRect(w * 0.64, h * 0.24, w * 0.08, h * 0.22);
  ctx.fillStyle = '#b06a2c'; ctx.fillRect(w * 0.25, h * 0.27, w * 0.14, h * 0.14); ctx.fillRect(w * 0.61, h * 0.27, w * 0.14, h * 0.14);
  ctx.fillStyle = '#c0392b'; ctx.fillRect(w * 0.44, h * 0.13, w * 0.12, h * 0.1);
  ctx.fillStyle = '#7d8a96'; ctx.fillRect(w * 0.26, h * 0.54, w * 0.48, h * 0.08);
  ctx.strokeStyle = '#36454f'; ctx.lineWidth = 1.2; ctx.beginPath();
  for (let i = 0; i <= 40; i++) { const x = w * (0.1 + i * 0.02), y = h * 0.82 - Math.exp(-i / 12) * Math.sin(i * 0.9) * h * 0.1; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
  ctx.stroke();
}
