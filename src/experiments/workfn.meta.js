// WorkFunctionExperiment 的目录信息与缩略图
export const meta = {
  id: 'workfn',
  part: '近代物理',
  title: '金属电子逸出功的测定',
  subtitle: '理想二极管热电子发射 · 肖特基效应外延求零场电流 · 理查森直线法求钨的逸出功',
  tags: ['近代物理', '热电子发射', '作图法'],
  level: '基础',
  time: '60 min',
  color: '#7a4a12',
  formula: String.raw`I=AST^2e^{-e\varphi/kT},\quad \lg\dfrac{I}{T^2}=\lg AS-5.04\times10^{3}\,\dfrac{\varphi}{T}`,
  measure: '钨的电子逸出功 eφ',
  goals: ['了解热电子发射的基本规律', '学习用理查森直线法处理数据，避开难以测准的 A 和 S', '学习用外延法由加速场下的阳极电流求零场发射电流', '学会用灯丝电流标定曲线确定阴极温度'],
  questions: ['为什么不直接用理查森公式由一组 I、T 算出 φ，而要作 lg(I/T²)–1/T 直线？', '为什么阳极电流随阳极电压增大而缓慢增大？怎样得到零场电流？', '阳极电压取 16、25、36…144 V 这样的平方数有什么方便之处？', '改变灯丝电流后为什么要等一会儿才能读数？', '灯丝温度标定偏高 1%，测得的逸出功偏大还是偏小？约多少？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#efe8df'; ctx.fillRect(0, 0, w, h);
  const x0 = w * 0.14, y0 = h * 0.86, x1 = w * 0.92, y1 = h * 0.12;
  ctx.strokeStyle = '#4b5963'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();
  ctx.fillStyle = '#7a4a12'; ctx.strokeStyle = '#7a4a12'; ctx.lineWidth = 2;
  const pts = [0.12, 0.3, 0.48, 0.66, 0.84];
  ctx.beginPath(); ctx.moveTo(x0 + 0.05 * (x1 - x0), y1 + 0.05 * (y0 - y1)); ctx.lineTo(x0 + 0.95 * (x1 - x0), y1 + 0.92 * (y0 - y1)); ctx.stroke();
  for (const p of pts) { const x = x0 + p * (x1 - x0) + 4, y = y1 + (0.05 + 0.87 * (p - 0.05) / 0.9) * (y0 - y1); ctx.beginPath(); ctx.arc(x, y + (p === 0.48 ? 3 : -2), 3.4, 0, 7); ctx.fill(); }
}
