// HallExperiment 的目录信息与缩略图
export const meta = {
  id: 'hall',
  title: '霍尔效应',
  subtitle: '对称测量法消除副效应 · V_H–I_s 与 V_H–I_M 关系 · 载流子类型、浓度与迁移率',
  tags: ['电学', '磁学', '半导体'],
  level: '提高',
  time: '60 min',
  color: '#1d4ed8',
  formula: String.raw`V_H=R_H\dfrac{I_sB}{d},\quad V_H=\dfrac{V_1-V_2+V_3-V_4}{4},\quad n=\dfrac{1}{|R_H|e},\quad \mu=|R_H|\sigma`,
  measure: '霍尔系数、载流子类型与浓度、电导率、迁移率',
  goals: ['了解霍尔效应的原理和霍尔元件的副效应', '学会用对称测量法（改变电流和磁场方向）消除副效应', '测绘 V_H–I_s、V_H–I_M 曲线，求半导体样品的霍尔系数、载流子浓度、电导率和迁移率，判断导电类型'],
  questions: ['四种换向组合中，哪些副效应能被消除，哪一个不能？为什么？', '如何根据 V_H 的正负判断样品是 N 型还是 P 型？需要知道哪些方向？', '测 V_σ 时为什么要把励磁电流调到零？', '为什么霍尔元件多用半导体而不用金属制作？', '把励磁电流误接到霍尔元件的工作电流输入端会有什么后果？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#e8ebef'; ctx.fillRect(0, 0, w, h);
  // 磁极
  ctx.fillStyle = '#3b4250'; ctx.fillRect(w * 0.2, h * 0.06, w * 0.6, h * 0.2); ctx.fillRect(w * 0.2, h * 0.74, w * 0.6, h * 0.2);
  ctx.fillStyle = '#c8cdd6'; ctx.font = `bold ${h * 0.12}px Arial`; ctx.textAlign = 'center'; ctx.fillText('N', w / 2, h * 0.21); ctx.fillText('S', w / 2, h * 0.89);
  // 样品
  ctx.fillStyle = '#2f6b3a'; ctx.fillRect(w * 0.24, h * 0.44, w * 0.52, h * 0.12);
  ctx.strokeStyle = '#1d4ed8'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 5; i++) { const x = w * (0.3 + i * 0.1); ctx.beginPath(); ctx.moveTo(x, h * 0.28); ctx.lineTo(x, h * 0.72); ctx.stroke(); }
  ctx.strokeStyle = '#c41e3a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(w * 0.08, h * 0.5); ctx.lineTo(w * 0.92, h * 0.5); ctx.stroke();
  ctx.fillStyle = '#c41e3a'; ctx.beginPath(); ctx.moveTo(w * 0.92, h * 0.5); ctx.lineTo(w * 0.86, h * 0.46); ctx.lineTo(w * 0.86, h * 0.54); ctx.fill();
  ctx.fillStyle = '#111'; ctx.font = `bold ${h * 0.1}px Arial`; ctx.fillText('+', w * 0.5, h * 0.42); ctx.fillText('−', w * 0.5, h * 0.66);
}
