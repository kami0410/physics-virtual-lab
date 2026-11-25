// PhotodiodeExperiment 的目录信息与缩略图
export const meta = {
  id: 'photodiode',
  part: '光学',
  title: '光敏二极管的光电特性',
  subtitle: '暗电流与伏安特性 · 光照特性测灵敏度 · 开路电压的对数规律 · 负载与时间响应',
  tags: ['光学', '光电器件', '半导体'],
  level: '提高',
  time: '75 min',
  color: '#5b4a1f',
  formula: String.raw`I_{ph}=S\,E,\quad U_{oc}=\dfrac{nkT}{e}\ln\dfrac{I_{ph}}{I_s},\quad t_r=2.2R_L(C_j+C_{in})`,
  measure: '暗电流、光电灵敏度 S（nA/lx）、理想因子 n、结电容 C_j',
  goals: ['了解光敏二极管的工作原理和光电导、光伏两种工作方式', '测量不同照度下的反向伏安特性和暗电流', '测量光电流与照度的关系，求光电灵敏度', '测量开路电压与照度的关系，验证对数规律并求理想因子', '用脉冲光和示波器测量上升时间，研究负载电阻对响应速度的影响并求结电容'],
  questions: ['光敏二极管为什么要加反向偏压使用？反向电压增大，暗电流和光电流各怎样变化？', '光电流与照度成线性关系，开路电压却与照度成对数关系，为什么？', '测开路电压时电压表内阻有限，照度很低时对结果有什么影响？', '负载电阻越大输出电压越大，但响应越慢，怎样折中？', '加大反向偏压为什么能提高响应速度？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#efe9dc'; ctx.fillRect(0, 0, w, h);
  const x0 = w * 0.12, y0 = h * 0.85, x1 = w * 0.92, y1 = h * 0.12;
  ctx.strokeStyle = '#6b5a35'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();
  const cs = ['#a9842f', '#8a6a24', '#6b4f17', '#4a360c'];
  cs.forEach((c, i) => {
    const lv = y0 - (i + 0.4) * h * 0.17;
    ctx.strokeStyle = c; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(x0, lv + h * 0.04);
    for (let k = 1; k <= 20; k++) { const x = x0 + (k / 20) * (x1 - x0); ctx.lineTo(x, lv - (1 - Math.exp(-k * 1.2)) * h * 0.04 - k * 0.15); }
    ctx.stroke();
  });
  ctx.fillStyle = '#c9a23a'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(w * (0.6 + i * 0.08), h * 0.06); ctx.lineTo(w * (0.66 + i * 0.08), h * 0.2); ctx.lineTo(w * (0.64 + i * 0.08), h * 0.2); ctx.fill(); }
}
