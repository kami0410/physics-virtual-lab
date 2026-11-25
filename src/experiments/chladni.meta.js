// ChladniExperiment 的目录信息与缩略图
export const meta = {
  id: 'chladni',
  part: '力学',
  title: '克拉尼图形与方板的振动模式',
  subtitle: '中心固定的方形钢板 · 扫频找共振 · 沙粒聚集在节线上 · 由共振频率求杨氏模量',
  tags: ['振动', '声学', '共振', '探究'],
  level: '提高',
  time: '60 min',
  color: '#5a4a32',
  formula: String.raw`f=\dfrac{\lambda}{2\pi L^2}\sqrt{\dfrac{D}{\rho h}},\quad D=\dfrac{Eh^3}{12(1-\nu^2)}`,
  measure: '方板各振动模式的共振频率、钢的杨氏模量、频率与板厚的关系',
  goals: ['观察方形薄板受迫振动的克拉尼图形，认识二维驻波的节线', '用扫频法找出薄板的一系列共振频率，与振型图谱对照辨认振动模式', '由共振频率和频率参数 λ 求钢的杨氏模量', '比较两种厚度的钢板，验证共振频率与板厚成正比'],
  questions: ['沙粒为什么会聚集在节线上？振幅太大或太小时图形有什么变化？', '为什么有的共振频率附近会看到两个很接近的图形？', '同一个振动模式，板厚加倍时频率怎样变化？边长加倍呢？', '弦的固有频率是基频的整数倍，薄板的固有频率是不是？这对它发出的声音意味着什么？', '把板的中心换成用手指按住某一点，能看到的图形会怎样变化？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#d9d2c4'; ctx.fillRect(0, 0, w, h);
  const s = Math.min(w, h) * 0.8, x0 = (w - s) / 2, y0 = (h - s) / 2;
  ctx.fillStyle = '#23272b'; ctx.fillRect(x0, y0, s, s);
  ctx.fillStyle = '#efe6cf';
  for (let i = 0; i < 2600; i++) {
    const u = Math.random() * 2 - 1, v = Math.random() * 2 - 1, f = Math.cos(1.5 * Math.PI * u) * Math.cos(0.5 * Math.PI * v) - Math.cos(0.5 * Math.PI * u) * Math.cos(1.5 * Math.PI * v);
    if (Math.abs(f) < 0.08) ctx.fillRect(x0 + ((u + 1) / 2) * s, y0 + ((v + 1) / 2) * s, 1.4, 1.4);
  }
}
