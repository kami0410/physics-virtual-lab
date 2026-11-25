// MusicExperiment 的目录信息与缩略图
export const meta = {
  id: 'music',
  part: '力学',
  title: '探究乐音：音调、音色与拍',
  subtitle: '弦音计调出 C 大调音阶 · 拨弦位置与谐波 · 两个音叉的拍 · 声卡示波器与频谱',
  tags: ['声学', '振动', '频谱', '探究'],
  level: '基础',
  time: '60 min',
  color: '#7a4b2a',
  formula: String.raw`f_1=\dfrac1{2L}\sqrt{\dfrac T\mu},\quad \dfrac{f_{k}}{f_0}=2^{k/12},\quad A_n\propto\dfrac{\sin(n\pi x_0/L)}{n},\quad f_{\text{拍}}=|f_A-f_B|`,
  measure: '音阶各音的弦长与频率、不同拨弦位置的谐波结构、拍频',
  goals: ['认识乐音的三要素：音调由基频决定，响度由振幅决定，音色由谐波的组成决定', '用弦音计按十二平均律调出 C 大调音阶，比较平均律与纯律', '用频谱分析研究拨弦位置对谐波的影响，理解“缺失的谐波”', '观察两个频率相近的音叉产生的拍，验证拍频等于两频率之差'],
  questions: ['弦长减半，音高怎样变化？为什么钢琴低音区的弦又长又粗？', '在弦长的 1/3 处拨弦，哪些谐波没有了？为什么？', '同一个音（同一个基频）用小提琴和长笛演奏，听起来为什么不一样？', '十二平均律的纯五度比纯律低多少音分？平均律有什么好处？', '调琴时乐师常常听拍来校音，拍越来越慢说明什么？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#efe7da'; ctx.fillRect(0, 0, w, h);
  const x0 = w * 0.1, y0 = h * 0.86, x1 = w * 0.92;
  ctx.strokeStyle = '#4b5963'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x0, h * 0.1); ctx.lineTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();
  ctx.fillStyle = '#7a4b2a';
  for (let n = 1; n <= 8; n++) { const a = Math.abs(Math.sin((n * Math.PI) / 3)) / (n * Math.sin(Math.PI / 3)); if (a < 0.01) continue; const x = x0 + ((x1 - x0) * n) / 9; ctx.fillRect(x - 2.5, y0 - a * h * 0.7, 5, a * h * 0.7); }
}
