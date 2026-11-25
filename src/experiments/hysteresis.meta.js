// HysteresisExperiment 的目录信息与缩略图
export const meta = {
  id: 'hysteresis',
  title: '示波器观测动态磁滞回线',
  subtitle: '退磁 · 基本磁化曲线与磁导率 · 饱和磁感应强度、剩磁、矫顽力 · 两种铁氧体比较',
  tags: ['电学', '磁学', '示波器'],
  level: '提高',
  time: '70 min',
  color: '#be123c',
  formula: String.raw`H=\dfrac{N_1}{lR_1}U_X,\quad B=\dfrac{R_2C}{N_2S}U_Y,\quad \mu=\dfrac{B}{\mu_0H}`,
  measure: '铁氧体的基本磁化曲线、μ–H 曲线和磁滞回线参数（Bₘ、Bᵣ、H_c）',
  goals: ['了解用示波器显示磁滞回线的原理：采样电阻取 H、RC 积分电路取 B', '学会退磁，测基本磁化曲线和 μ–H 曲线', '由磁滞回线求饱和磁感应强度、剩磁和矫顽力，比较两种磁性材料'],
  questions: ['为什么测基本磁化曲线之前必须先退磁？退磁时电压为什么要从最大值缓慢减到零？', '次级回路中为什么要求 R₂C 远大于交流电的周期？', '示波器 X、Y 两路各显示什么物理量？怎样把格数换算成 H 和 B？', '根据测得的回线，哪种样品更适合做变压器铁芯，哪种更适合做永磁体？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#c7c9c4'; ctx.fillRect(0, 0, w, h);
  const x = w * 0.08, y = h * 0.1, sw = w * 0.84, sh = h * 0.8;
  ctx.fillStyle = '#050c08'; ctx.fillRect(x, y, sw, sh);
  ctx.strokeStyle = 'rgba(170,210,190,.3)'; ctx.lineWidth = 0.6; ctx.beginPath();
  for (let i = 0; i <= 10; i++) { ctx.moveTo(x + (i * sw) / 10, y); ctx.lineTo(x + (i * sw) / 10, y + sh); }
  for (let j = 0; j <= 8; j++) { ctx.moveTo(x, y + (j * sh) / 8); ctx.lineTo(x + sw, y + (j * sh) / 8); }
  ctx.stroke();
  const cx = x + sw / 2, cy = y + sh / 2;
  const br = (t, s) => Math.tanh(3 * (t + s * 0.28)) * 0.82;
  for (const [lw, c] of [[4, 'rgba(60,255,120,.22)'], [1.3, '#a6ffbf']]) {
    ctx.lineWidth = lw; ctx.strokeStyle = c; ctx.beginPath();
    for (let i = 0; i <= 200; i++) { const t = -1 + (2 * i) / 200; const px = cx + t * sw * 0.42, py = cy - br(t, -1) * sh * 0.42; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    for (let i = 0; i <= 200; i++) { const t = 1 - (2 * i) / 200; ctx.lineTo(cx + t * sw * 0.42, cy - br(t, 1) * sh * 0.42); }
    ctx.stroke();
  }
}
