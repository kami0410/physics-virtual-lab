// EFieldExperiment 的目录信息与缩略图
export const meta = {
  id: 'efield',
  part: '电磁学',
  title: '模拟法描绘静电场',
  subtitle: '导电纸 · 同轴电极 · 两平行长直导线 · 等势线与电场线',
  tags: ['电磁学', '电学', '静电场'],
  level: '基础',
  time: '90 min',
  color: '#a86a12',
  formula: String.raw`U(r)=U_0\dfrac{\ln(r_2/r)}{\ln(r_2/r_1)},\quad E=\dfrac{U_0}{r\ln(r_2/r_1)}`,
  measure: '同轴电极间的等势线分布',
  goals: ['理解用稳恒电流场模拟静电场的原理和条件', '用探针和电压表描绘等势线，并画出电场线', '验证同轴电极间电位随半径的对数分布', '观察两等量异号线电荷、平行板电极的电场分布与边缘效应'],
  questions: ['用电流场模拟静电场需要满足什么条件？', '如果导电纸各处的电导率不均匀，等势线会怎样变化？', '把电源电压加倍，等势线的形状和位置变不变？', '为什么离内电极越近，等势线越密？', '电场线为什么一定与等势线正交？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#f2f4f0'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#d3e2d7'; ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 9) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += 9) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  const cx = w / 2, cy = h / 2, R = w * 0.42;
  ctx.strokeStyle = '#4b5563'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
  ctx.fillStyle = '#6b7280'; ctx.beginPath(); ctx.arc(cx, cy, R * 0.13, 0, 7); ctx.fill();
  const cols = ['#c41e3a', '#a86a12', '#2d7a4e', '#1d4ed8'];
  [0.2, 0.4, 0.6, 0.8].forEach((u, k) => { const r = R * Math.pow(0.13, u); ctx.fillStyle = cols[k]; for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4 + 0.2; ctx.beginPath(); ctx.arc(cx + r * Math.cos(a), cy + r * Math.sin(a), 2.4, 0, 7); ctx.fill(); } });
}
