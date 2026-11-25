// ZeemanExperiment 的目录信息与缩略图
export const meta = {
  id: 'zeeman',
  part: '近代物理',
  title: '塞曼效应',
  subtitle: '汞 546.1 nm 谱线的反常塞曼分裂 · F-P 标准具 · 偏振鉴别 π 与 σ 成分 · 测电子荷质比',
  tags: ['近代物理', '原子光谱', 'F-P 标准具'],
  level: '较难',
  time: '90 min',
  color: '#2f8a4a',
  formula: String.raw`\Delta\tilde\nu=\Delta(Mg)\dfrac{eB}{4\pi mc},\quad \dfrac em=\dfrac{2\pi c}{dB}\cdot\dfrac{D_b^2-D_a^2}{D_{k-1}^2-D_k^2}`,
  measure: '电子荷质比 e/m',
  goals: ['观察汞 546.1 nm 谱线在磁场中分裂为 9 条，认识反常塞曼效应', '用偏振片区分 π 成分与 σ 成分，理解它们的偏振特性', '学会调节法布里–珀罗标准具的观察光路，用测微目镜测量干涉圆环的直径', '由 π 成分的分裂量计算电子荷质比'],
  questions: ['为什么 546.1 nm 谱线分裂成 9 条而不是正常塞曼效应的 3 条？', '沿垂直于磁场的方向观察，π 成分和 σ 成分各是什么偏振？沿磁场方向观察呢？', '磁场太强时，相邻两级的分裂谱线会发生什么？标准具间隔 d 应该怎样选？', '测量直径时为什么叉丝要从一侧一直朝同一方向移动？', '如果水平叉丝没有通过圆环中心，测得的 e/m 偏大还是偏小？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#020604'; ctx.fillRect(0, 0, w, h);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r2 = ((x - w / 2) ** 2 + (y - h / 2) ** 2) / (w * w);
    let I = 0;
    for (const s of [-0.09, 0, 0.09]) { const d = 2 * Math.PI * (r2 * 9 + 0.45 + s); I += (s ? 0.75 : 1) / (1 + 60 * Math.sin(d / 2) ** 2); }
    const k = (y * w + x) * 4; img.data[k] = 90 * Math.min(1, I); img.data[k + 1] = 255 * Math.min(1, I); img.data[k + 2] = 120 * Math.min(1, I); img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
