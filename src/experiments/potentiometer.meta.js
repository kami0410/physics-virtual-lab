// PotentiometerExperiment 的目录信息与缩略图
export const meta = {
  id: 'potentiometer',
  title: '十一线电位差计测电动势',
  subtitle: '补偿法 · 标准电池的温度修正 · 校准工作电流 · 干电池的电动势与内阻',
  tags: ['电学', '补偿法', '电位差计'],
  level: '基础',
  time: '60 min',
  color: '#9a3412',
  formula: String.raw`U_0=\dfrac{E_s}{L_s},\quad E_x=U_0L_x=\dfrac{L_x}{L_s}E_s,\quad r=\left(\dfrac{L_x}{L'}-1\right)R`,
  measure: '干电池的电动势、内阻',
  goals: ['理解补偿法测电动势的原理：平衡时被测电池中没有电流', '学会用标准电池校准电位差计的工作电流，掌握标准电池电动势的温度修正', '用十一线电位差计测干电池的电动势和内阻'],
  questions: ['用电压表直接测干电池两端电压，得到的是电动势吗？电位差计为什么能测出电动势？', '校准工作电流后，为什么在测量过程中不能再动调节电阻 Rp？', '如果怎么调都找不到平衡点，可能是哪些原因？', '为什么标准电池只允许通过很小的电流、只能跃接？保护电阻起什么作用？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#d9c7a3'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#b89a68'; ctx.fillRect(w * 0.06, h * 0.12, w * 0.88, h * 0.76);
  ctx.strokeStyle = '#6b6b6b'; ctx.lineWidth = 1.2;
  const x0 = w * 0.12, x1 = w * 0.88;
  for (let i = 0; i < 7; i++) { const y = h * (0.2 + i * 0.075); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); }
  ctx.fillStyle = '#c8a24a';
  for (let i = 0; i < 7; i++) { const y = h * (0.2 + i * 0.075); ctx.beginPath(); ctx.arc(i % 2 ? x1 : x0, y, 2.5, 0, 7); ctx.fill(); }
  const ys = h * 0.74;
  ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x0, ys); ctx.lineTo(x1, ys); ctx.stroke();
  ctx.fillStyle = '#efe6cf'; ctx.fillRect(x0, ys + 3, x1 - x0, 8);
  ctx.strokeStyle = '#333'; ctx.lineWidth = 0.6; ctx.beginPath();
  for (let i = 0; i <= 50; i++) { const x = x0 + (i / 50) * (x1 - x0); ctx.moveTo(x, ys + 3); ctx.lineTo(x, ys + (i % 5 ? 6 : 9)); }
  ctx.stroke();
  ctx.fillStyle = '#111'; ctx.fillRect(x0 + (x1 - x0) * 0.42 - 3, ys - 7, 6, 8);
  ctx.fillStyle = '#c41e3a'; ctx.beginPath(); ctx.arc(x1, h * 0.425, 3.5, 0, 7); ctx.fill();
}
