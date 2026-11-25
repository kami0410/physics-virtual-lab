// RlcExperiment 的目录信息与缩略图
export const meta = {
  id: 'rlc',
  title: 'RC、RLC 电路的暂态过程',
  subtitle: '方波激励 · 半衰期法测时间常数 · 欠阻尼振荡与对数衰减率 · 临界阻尼',
  tags: ['电学', '示波器', '暂态'],
  level: '提高',
  time: '75 min',
  color: '#7c3aed',
  formula: String.raw`\tau=RC=\dfrac{t_{1/2}}{\ln 2},\quad T_d=\dfrac{2\pi}{\sqrt{\frac{1}{LC}-\frac{R^2}{4L^2}}},\quad R_c=2\sqrt{\dfrac{L}{C}}`,
  measure: 'RC 电路的时间常数、RLC 电路的振荡周期与总电阻、临界电阻',
  goals: ['用示波器观察 RC 电路的充放电过程，用半衰期法测时间常数', '观察 RLC 串联电路在欠阻尼、临界阻尼、过阻尼三种状态下的暂态过程', '由欠阻尼振荡的周期和振幅衰减求电路的总电阻，测临界电阻'],
  questions: ['方波的周期与时间常数应满足什么关系？太短会看到什么？', '计算时间常数时为什么要计入信号发生器的内阻？', '临界电阻的实验值为什么往往比理论值偏小？', '欠阻尼振荡的周期与 LC 回路的固有周期有什么不同？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#c7c9c4'; ctx.fillRect(0, 0, w, h);
  const x = w * 0.08, y = h * 0.1, sw = w * 0.84, sh = h * 0.8;
  ctx.fillStyle = '#050c08'; ctx.fillRect(x, y, sw, sh);
  ctx.strokeStyle = 'rgba(170,210,190,.3)'; ctx.lineWidth = 0.6; ctx.beginPath();
  for (let i = 0; i <= 10; i++) { ctx.moveTo(x + (i * sw) / 10, y); ctx.lineTo(x + (i * sw) / 10, y + sh); }
  for (let j = 0; j <= 8; j++) { ctx.moveTo(x, y + (j * sh) / 8); ctx.lineTo(x + sw, y + (j * sh) / 8); }
  ctx.stroke();
  const tr = (f) => { for (const [lw, c] of [[4, 'rgba(60,255,120,.22)'], [1.3, '#a6ffbf']]) { ctx.lineWidth = lw; ctx.strokeStyle = c; ctx.beginPath(); for (let i = 0; i <= 240; i++) { const t = i / 240, p = f(t); i ? ctx.lineTo(x + t * sw, y + sh * (1 - p)) : ctx.moveTo(x + t * sw, y + sh * (1 - p)); } ctx.stroke(); } };
  tr((t) => 0.12 + 0.3 * (t < 0.5 ? 1 - Math.exp(-t * 14) : Math.exp(-(t - 0.5) * 14)));
  tr((t) => 0.52 + 0.3 * (t < 0.06 ? 0 : 1 - Math.exp(-(t - 0.06) * 6) * Math.cos((t - 0.06) * 60)) * 0.9);
}
