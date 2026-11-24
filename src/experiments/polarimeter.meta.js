// PolarimeterExperiment 的目录信息与缩略图（目录页只加载这一部分，进入实验时才加载实验本体与三维引擎）

export const meta = {
  id: 'polarimeter',
  title: '旋光仪测糖溶液浓度',
  subtitle: '半荫法三分视场找“暗度相等” · 零点校正 · 比旋光度与未知浓度',
  tags: ['波动光学', '偏振', '旋光'],
  level: '基础',
  time: '40 min',
  color: '#7a5a12',
  formula: String.raw`\varphi=[\alpha]\,l\,c`,
  measure: '比旋光度 [α]、未知溶液浓度 c',
  goals: ['观察线偏振光通过旋光物质时振动面的旋转', '掌握旋光仪（半荫式）的结构和使用方法，学会用“暗度相等”判断零点', '测定蔗糖溶液的比旋光度，并由旋光角求未知溶液浓度'],
  questions: ['为什么要选“暗度相等”而不是“亮度相等”的视场作为测量位置？', '两个游标读数取平均消除了什么误差？', '试管中有气泡时应如何处理？为什么？', '如何判断一种溶液是右旋还是左旋？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#0e0c08'; ctx.fillRect(0, 0, w, h);
  const r = Math.min(w, h) * 0.36, cx = w / 2, cy = h / 2;
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#6b4d10'; ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  ctx.fillStyle = '#2a1e06'; ctx.fillRect(cx - r * 0.22, cy - r, r * 0.44, 2 * r);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,220,150,.35)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
}
