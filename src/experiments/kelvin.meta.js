// KelvinExperiment 的目录信息与缩略图
export const meta = {
  id: 'kelvin',
  part: '电磁学',
  title: '双臂电桥测低电阻',
  subtitle: '四端接法 · 跨线电阻的消除 · 电流换向消除温差电动势 · 金属电阻率',
  tags: ['电磁学', '电桥'],
  level: '提高',
  time: '90 min',
  color: '#7a5c2e',
  formula: String.raw`R_x=\frac{R_1}{R_2}R_n`,
  measure: '金属棒的电阻与电阻率',
  goals: ['理解四端接法和双臂电桥消除导线电阻、接触电阻的原理', '学会连接和调节双臂电桥测量 10⁻⁴ Ω 量级的低电阻', '用电流换向法消除温差电动势的影响', '用 Rₓ–L 作图法测金属的电阻率'],
  questions: ['如果把待测棒的电位端和电流端接反，测得的电阻会怎样？大约差多少？', '为什么要求 R₁ = R₁′、R₂ = R₂′？跨线电阻 r 为什么要尽量小？', '正、反向电流下平衡时 R₂ 为什么不同？取平均为什么能消除温差电动势？', '工作电流取 2 A 而不是 0.2 A，有什么好处？电流太大又有什么问题？', 'Rₓ–L 图的截距不为零说明什么？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#e8ebef'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#1d2832'; ctx.lineWidth = 1.6;
  const y = h * 0.68, box = (x, wd, c) => { ctx.fillStyle = c; ctx.fillRect(x, y - 6, wd, 12); ctx.strokeRect(x, y - 6, wd, 12); };
  ctx.beginPath(); ctx.moveTo(w * 0.05, y); ctx.lineTo(w * 0.95, y); ctx.stroke();
  box(w * 0.12, w * 0.3, '#b87333'); box(w * 0.58, w * 0.24, '#c8a24a');
  ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(w * 0.42, y); ctx.lineTo(w * 0.58, y); ctx.stroke(); ctx.lineWidth = 1.4;
  for (const [x1, x2, yy] of [[0.17, 0.77, 0.2], [0.37, 0.63, 0.42]]) { ctx.beginPath(); ctx.moveTo(w * x1, y - 6); ctx.lineTo(w * x1, h * yy); ctx.lineTo(w * x2, h * yy); ctx.lineTo(w * x2, y - 6); ctx.stroke(); }
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(w * 0.5, h * 0.31, h * 0.08, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#1d2832'; ctx.font = `italic ${h * 0.11}px serif`; ctx.textAlign = 'center'; ctx.fillText('G', w * 0.5, h * 0.35);
}
