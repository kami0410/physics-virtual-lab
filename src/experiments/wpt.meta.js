// WptExperiment 的目录信息与缩略图
export const meta = {
  id: 'wpt',
  part: '电磁学',
  title: '磁耦合谐振式无线输电',
  subtitle: '谐振频率与线圈自感 · 互感法测耦合系数 · 频率分裂 · 传输效率与临界耦合',
  tags: ['电磁学', '电磁感应', '谐振'],
  level: '提高',
  time: '75 min',
  color: '#3d5a3a',
  formula: String.raw`f_0=\dfrac{1}{2\pi\sqrt{LC}},\quad k=\dfrac{M}{L}=\dfrac{U_{2}}{\omega L I_1},\quad \eta=\dfrac{P_2}{P_1}`,
  measure: '线圈自感 L、耦合系数 k 随距离的变化、频率分裂、传输效率与负载功率',
  goals: ['理解磁耦合谐振式无线输电的原理', '由谐振频率测线圈自感，学会调谐接收线圈', '用互感法测耦合系数随距离的变化，并与诺依曼公式的计算值比较', '观察近距离时的频率分裂现象', '测传输效率和负载功率随距离的变化，认识临界耦合'],
  questions: ['为什么发射、接收线圈要调到同一个谐振频率？', '线圈靠得很近时，负载电压的频率特性为什么出现两个峰？', '传输效率随距离单调下降，负载功率却在某个距离最大，为什么？', '用分裂频率算出的耦合系数为什么比互感法小？', '提高传输距离可以从哪些方面入手？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#e6ece3'; ctx.fillRect(0, 0, w, h);
  const coil = (cx) => { ctx.strokeStyle = '#b06a2c'; ctx.lineWidth = 1.6; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(cx, h * 0.5, w * 0.03 + i * 0.6, h * 0.2 + i * 2.2, 0, 0, 7); ctx.stroke(); } };
  coil(w * 0.3); coil(w * 0.7);
  ctx.strokeStyle = 'rgba(61,90,58,.55)'; ctx.lineWidth = 1;
  for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(w * 0.34, h * 0.5 + i * h * 0.06); ctx.bezierCurveTo(w * 0.45, h * 0.5 + i * h * 0.15, w * 0.55, h * 0.5 + i * h * 0.15, w * 0.66, h * 0.5 + i * h * 0.06); ctx.stroke(); }
  ctx.fillStyle = '#f2c94c'; ctx.beginPath(); ctx.arc(w * 0.9, h * 0.3, h * 0.07, 0, 7); ctx.fill();
}
