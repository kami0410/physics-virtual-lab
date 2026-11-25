// GammaExperiment 的目录信息与缩略图
export const meta = {
  id: 'gamma',
  part: '热学',
  title: '空气比热容比的测定',
  subtitle: '绝热膨胀法 · 压强与温度传感器 · 放气时机对结果的影响',
  tags: ['热学', '热力学过程'],
  level: '基础',
  time: '60 min',
  color: '#5d7682',
  formula: String.raw`\gamma=\frac{C_p}{C_v}=\frac{\ln(p_1/p_0)}{\ln(p_1/p_2)}`,
  measure: '空气的比热容比 γ',
  goals: ['用绝热膨胀法测定空气的比热容比', '观察绝热膨胀、等容吸热过程中压强和温度的变化', '学会使用压强传感器和集成温度传感器 AD590', '分析放气时机等操作因素对结果的影响'],
  questions: ['为什么要等温度回到室温才记录 p₁ 和 p₂？', '放气阀关得太早或太晚，测得的 γ 分别偏大还是偏小？为什么？', '为什么压强传感器的灵敏度误差几乎不影响结果，而零点误差会影响？', '如果瓶子漏气，对结果有什么影响？', '测得的 γ 略小于 1.40，可能的原因是什么？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#e8ebef'; ctx.fillRect(0, 0, w, h);
  const x0 = w * 0.12, x1 = w * 0.9, y0 = h * 0.15, y1 = h * 0.85;
  ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.strokeStyle = '#2f6b4f'; ctx.lineWidth = 1.6; ctx.beginPath();
  const pts = [[0, 0.95], [0.08, 0.2], [0.35, 0.28], [0.36, 0.95], [0.4, 0.93], [0.7, 0.73], [1, 0.72]];
  pts.forEach(([u, v], i) => { const X = x0 + u * (x1 - x0), Y = y0 + v * (y1 - y0); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
  ctx.stroke();
  ctx.fillStyle = '#4b5963'; ctx.font = `${h * 0.1}px serif`;
  ctx.fillText('Ⅰ', x0 + 0.26 * (x1 - x0), y0 + 0.2 * (y1 - y0)); ctx.fillText('Ⅲ', x0 + 0.82 * (x1 - x0), y0 + 0.65 * (y1 - y0));
}
