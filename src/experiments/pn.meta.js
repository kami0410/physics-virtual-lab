// PnExperiment 的目录信息与缩略图
export const meta = {
  id: 'pn',
  part: '热学',
  title: 'PN 结与热敏电阻的温度特性',
  subtitle: '伏安特性测玻尔兹曼常数 · 恒流 U_F–T 求禁带宽度 · 热敏电阻 B 值',
  tags: ['热学', '温度传感器', '半导体'],
  level: '提高',
  time: '75 min',
  color: '#2f6f5f',
  formula: String.raw`I=I_s\left(e^{eU/kT}-1\right),\quad U_F=\dfrac{E_g(0)}{e}+ST,\quad R_T=R_{25}e^{B\left(\frac1T-\frac1{T_{25}}\right)}`,
  measure: '玻尔兹曼常数 k、PN 结温度灵敏度 S 与硅的禁带宽度、热敏电阻的 B 值',
  goals: ['测量室温下 PN 结的正向伏安特性，由指数规律求玻尔兹曼常数', '在恒定正向电流下测量 PN 结正向压降随温度的变化，求温度灵敏度 S 并外推得到硅的禁带宽度', '测量 NTC 热敏电阻的阻值随温度的变化，求材料常数 B', '学会用运算放大器做电流–电压变换测量微弱电流'],
  questions: ['为什么伏安特性要在较小的正向电流下测量？电流大时 ln I–U 图线为什么会向下弯？', '测 U_F–T 时为什么要保持正向电流恒定？电流取 10 μA 和 100 μA，S 会有什么不同？', '把 U_F–T 直线外推到 0 K 得到的电压比硅的禁带宽度略大，原因是什么？', '热敏电阻和 PN 结作温度传感器，各有什么优缺点？', '升温时温控仪示数已经稳定，PN 结压降还在变化，说明了什么？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#e9eee9'; ctx.fillRect(0, 0, w, h);
  const x0 = w * 0.16, y0 = h * 0.84, x1 = w * 0.88, y1 = h * 0.14;
  ctx.strokeStyle = '#4b5963'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();
  // U_F 随 T 线性下降，R_T 指数下降
  ctx.strokeStyle = '#2f6f5f'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(x0 + 4, y1 + h * 0.12); ctx.lineTo(x1 - 4, y0 - h * 0.28); ctx.stroke();
  ctx.strokeStyle = '#c41e3a'; ctx.beginPath();
  for (let i = 0; i <= 30; i++) { const t = i / 30, x = x0 + 4 + t * (x1 - x0 - 8), y = y0 - 6 - (h * 0.6) * Math.exp(-3.2 * t); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.stroke();
  ctx.fillStyle = '#1d2832'; ctx.font = `${Math.round(h * 0.12)}px serif`; ctx.fillText('T', x1 - h * 0.05, y0 + h * 0.13);
}
