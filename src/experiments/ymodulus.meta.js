// YModulusExperiment 的目录信息与缩略图
export const meta = {
  id: 'ymodulus',
  part: '力学',
  title: '拉伸法测金属丝的杨氏模量',
  subtitle: '光杠杆放大微小伸长 · 望远镜尺组读数 · 逐差法 · 螺旋测微器与游标卡尺',
  tags: ['力学', '弹性', '光杠杆'],
  level: '基础',
  time: '90 min',
  color: '#475569',
  formula: String.raw`E=\dfrac{8FLD}{\pi d^2 b\,\Delta n},\qquad \Delta L=\dfrac{b}{2D}\Delta n`,
  measure: '钢丝的杨氏模量',
  goals: ['学会用光杠杆测量微小长度变化，理解光学放大的原理', '掌握望远镜尺组的调节和读数方法', '学会用螺旋测微器、游标卡尺和钢卷尺测长度，注意零点修正', '用逐差法处理等间隔数据，按不确定度传递公式评定测量结果'],
  questions: ['光杠杆的放大倍数是多少？怎样提高它？提高放大倍数会带来什么问题？', '为什么要先加预载砝码？不加预载的数据有什么特点？', '为什么要在加载和减载时各读一次，取平均？', '本实验中哪个量的测量对结果的不确定度影响最大？应怎样测它？', '实验架底座不水平会对测量有什么影响？', '为什么用逐差法而不是简单地取相邻读数之差的平均？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#e8ebef'; ctx.fillRect(0, 0, w, h);
  // 立柱与横梁
  ctx.fillStyle = '#3b4250'; ctx.fillRect(w * 0.14, h * 0.06, w * 0.05, h * 0.88); ctx.fillRect(w * 0.42, h * 0.06, w * 0.05, h * 0.88); ctx.fillRect(w * 0.12, h * 0.06, w * 0.37, h * 0.05);
  // 钢丝与砝码
  ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(w * 0.305, h * 0.11); ctx.lineTo(w * 0.305, h * 0.55); ctx.stroke();
  ctx.fillStyle = '#6b7280'; ctx.fillRect(w * 0.12, h * 0.55, w * 0.37, h * 0.035);
  ctx.fillStyle = '#a16207'; for (let i = 0; i < 4; i++) ctx.fillRect(w * 0.25, h * (0.66 + i * 0.055), w * 0.11, h * 0.045);
  // 光杠杆与望远镜
  ctx.fillStyle = '#c7d2fe'; ctx.fillRect(w * 0.36, h * 0.44, w * 0.02, h * 0.1);
  ctx.strokeStyle = '#c41e3a'; ctx.lineWidth = 1; ctx.setLineDash([3, 2]); ctx.beginPath(); ctx.moveTo(w * 0.38, h * 0.48); ctx.lineTo(w * 0.82, h * 0.4); ctx.moveTo(w * 0.38, h * 0.48); ctx.lineTo(w * 0.82, h * 0.3); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#f8fafc'; ctx.fillRect(w * 0.84, h * 0.14, w * 0.07, h * 0.5);
  ctx.fillStyle = '#111'; for (let i = 0; i < 10; i++) ctx.fillRect(w * 0.84, h * (0.16 + i * 0.048), w * (i % 5 === 0 ? 0.04 : 0.025), 1);
  ctx.fillStyle = '#1f2937'; ctx.fillRect(w * 0.72, h * 0.38, w * 0.12, h * 0.05);
  ctx.fillStyle = '#3b4250'; ctx.fillRect(w * 0.86, h * 0.64, w * 0.03, h * 0.3);
}
