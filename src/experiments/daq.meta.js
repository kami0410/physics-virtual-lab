// DaqExperiment 的目录信息与缩略图
export const meta = {
  id: 'daq',
  part: '电磁学',
  title: '传感器与数据采集',
  subtitle: '应变式称重传感器的标定（线性度、迟滞）· 采样定理与混叠 · ADC 量化噪声',
  tags: ['电学', '传感器', '数据采集'],
  level: '基础',
  time: '60 min',
  color: '#3c4f6b',
  formula: String.raw`U=S\,m,\quad f_a=\left|f-f_s\,\mathrm{round}\!\left(\dfrac{f}{f_s}\right)\right|,\quad \sigma_q=\dfrac{\mathrm{LSB}}{\sqrt{12}}`,
  measure: '称重传感器的灵敏度、非线性误差、迟滞误差、未知质量；混叠频率；不同位数 ADC 的量化噪声',
  goals: ['了解电阻应变片全桥称重传感器、仪表放大器和数据采集卡组成的测量系统', '用砝码标定传感器，求灵敏度、非线性误差和迟滞误差，并用它测未知质量', '验证采样定理，观察混叠现象', '测量不同位数 ADC 的量化噪声，与 LSB/√12 比较'],
  questions: ['全桥接法比单臂接法有什么好处？', '为什么标定时要加载、卸载各做一遍？', '采样频率为 1000 Hz 时，1130 Hz 的正弦信号看起来是多少赫兹？怎样防止混叠？', '16 位 ADC 的残差为什么不再等于 LSB/√12？', '多次采样取平均为什么能提高静态测量的分辨率？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#e5e9ef'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#3c4f6b'; ctx.lineWidth = 1.4; ctx.beginPath();
  for (let i = 0; i <= 120; i++) { const x = w * (0.06 + i * 0.0074), y = h * 0.45 - Math.sin(i * 0.31) * h * 0.25; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
  ctx.stroke();
  ctx.fillStyle = '#b3261e';
  for (let i = 0; i <= 5; i++) { const x = w * (0.06 + i * 22 * 0.0074), y = h * 0.45 - Math.sin(i * 22 * 0.31) * h * 0.25; ctx.beginPath(); ctx.arc(x, y, 2.4, 0, 7); ctx.fill(); }
  ctx.strokeStyle = 'rgba(179,38,30,.6)'; ctx.setLineDash([3, 3]); ctx.beginPath();
  for (let i = 0; i <= 120; i++) { const x = w * (0.06 + i * 0.0074), y = h * 0.45 - Math.sin(i * (22 * 0.31 - 2 * Math.PI) / 22) * h * 0.25; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
  ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#3c4f6b'; for (let i = 0; i < 14; i++) ctx.fillRect(w * (0.08 + i * 0.062), h * 0.92 - (i % 5 + 1) * h * 0.035, w * 0.04, (i % 5 + 1) * h * 0.035);
}
