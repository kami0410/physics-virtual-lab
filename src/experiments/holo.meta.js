// HoloExperiment 的目录信息与缩略图（目录页只加载这一部分，进入实验时才加载实验本体与三维引擎）

export const meta = {
  id: 'holo',
  title: '全息照相',
  subtitle: '离轴透射全息 · 等光程与相干长度 · 光强比与曝光量 · 冲洗、漂白与再现',
  tags: ['波动光学', '全息', '光学平台'],
  level: '综合',
  time: '90 min',
  color: '#b91c1c',
  formula: String.raw`K=\dfrac{I_r}{I_o},\quad t=\dfrac{E_0}{I_r+I_o}`,
  measure: '参考光与物光的光强比 K、曝光时间 t',
  goals: ['理解全息照相记录与再现的原理', '学会在防震平台上布置离轴全息光路：分束、扩束、等光程', '用光功率计测光强比，按干板的最佳曝光量计算曝光时间', '完成曝光、显影、定影、漂白，观察再现虚像的立体感和视差'],
  questions: ['为什么物光和参考光的光程差要小于激光的相干长度？光程差约等于谐振腔长时会怎样？', '光强比 K 太小或太大对全息图有什么影响？', '把全息图打碎成小块，还能看到完整的物体吗？像有什么变化？', '曝光过程中平台振动 λ/4 会造成什么后果？'],
};

export function thumb(ctx, w, h) {
  ctx.fillStyle = '#0b0606'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 1600; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const inC = Math.abs(x - w * 0.42) < w * 0.17 && Math.abs(y - h * 0.5) < h * 0.27;
    const inB = Math.hypot(x - w * 0.7, y - h * 0.56) < h * 0.17;
    const b = (inC || inB ? 0.9 : 0.12) * -Math.log(Math.random() + 1e-3) * 0.5;
    ctx.fillStyle = `rgba(255,${40 + 40 * b},${30 + 30 * b},${Math.min(1, b)})`; ctx.fillRect(x, y, 1.6, 1.6);
  }
}
