// RlcSteadyExperiment 的目录信息与缩略图
export const meta = {
  id: 'rlcss',
  part: '电磁学',
  title: 'RC、RLC 串联电路的稳态特性',
  subtitle: '正弦激励 · 双踪示波器测相位差 · 相频特性 · 串联谐振曲线与品质因数',
  tags: ['电学', '交流电路', '示波器'],
  level: '提高',
  time: '90 min',
  color: '#3b5b8a',
  formula: String.raw`\tan\varphi=\dfrac{1}{\omega RC},\quad f_0=\dfrac{1}{2\pi\sqrt{LC}},\quad Q=\dfrac{f_0}{f_2-f_1}=\dfrac1R\sqrt{\dfrac LC}`,
  measure: 'RC 电路的相频特性，RLC 串联谐振频率与品质因数',
  goals: ['学会用双踪示波器测两个同频正弦信号的相位差', '测 RC 串联电路中电流与总电压的相位差随频率的变化', '测 RLC 串联电路的谐振曲线，求谐振频率、通频带和品质因数', '用李萨如图形判断谐振'],
  questions: ['RC 串联电路中，电流超前还是落后于总电压？频率升高时相位差怎样变化？', '为什么用电阻上的电压来代表回路电流？电阻应接在什么位置？', '谐振时电路呈什么性质？电阻上的电压为什么不等于信号源的开路电压？', '品质因数与哪些量有关？电感线圈的电阻对 Q 有什么影响？', '谐振时 X-Y 方式下看到的李萨如图形是什么形状？为什么？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#e6e9ee'; ctx.fillRect(0, 0, w, h);
  const x0 = w * 0.1, y0 = h * 0.86, x1 = w * 0.92;
  ctx.strokeStyle = '#4b5963'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x0, h * 0.08); ctx.lineTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();
  for (const [q, c] of [[1.5, '#8aa0b0'], [3, '#3b5b8a'], [6, '#c41e3a']]) {
    ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i <= 80; i++) { const r = 0.4 + (1.2 * i) / 80, Y = 1 / Math.sqrt(1 + q * q * (r - 1 / r) ** 2), x = x0 + ((x1 - x0) * i) / 80, y = y0 - Y * h * 0.72; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
  }
}
