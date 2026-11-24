// 光路设计台的预设场景：对应大学物理实验与光学课程中的典型光路。坐标单位 mm。
import { makeElement as E } from './elements.js';
import { index } from '../physics/glassdb.js';
import { LENSES, paraxial, vertices } from '../physics/lensTrace.js';

const R2D = 180 / Math.PI, D2R = Math.PI / 180;
/** 点光源对准某点 */
const aim = (x, y, tx, ty) => Math.atan2(ty - y, tx - x) * R2D;

export const PRESETS = [
  {
    id: 'imaging', title: '凸透镜成像', note: '物点发出的光经 K9 双凸透镜会聚成倒立实像。拖动透镜或光屏，观察像点位置与物距的关系，可与高斯公式 1/u + 1/v = 1/f 比较；口径大时边缘光线会聚得更近（球差）。',
    view: { cx: 0, cy: 0, w: 560 },
    build: () => [
      E('point', { x: -240, y: 15, rot: aim(-240, 15, 0, 0), cone: 8, n: 31, lam: 587.6 }),
      E('point', { x: -240, y: 0, rot: 0, cone: 8, n: 31, lam: 587.6 }),
      E('lens', { x: 0, y: 0, R1: 100, R2: -100, d: 6, D: 40, mat: 'K9' }),
      E('detector', { x: 166, y: 0, L: 40 }),
    ],
  },
  {
    id: 'sa', title: '球差与焦散', note: '宽平行光照射平凸透镜（凸面朝光源）。离轴越远的光线焦点越靠近透镜，包络线即焦散线。把透镜转 180°（平面朝光源），球差显著增大——这就是“平凸透镜凸面应朝向平行光”的原因。',
    view: { cx: 30, cy: 0, w: 320 },
    build: () => [
      E('beam', { x: -100, y: 0, w: 56, n: 41, lam: 587.6 }),
      E('lens', { x: 0, y: 0, R1: 60, R2: 0, d: 12, D: 60, mat: 'K9' }),
      E('detector', { x: 114, y: 0, L: 40, pass: true }),
    ],
  },
  {
    id: 'chroma', title: '色差与消色差透镜', note: '上：单片 K9 透镜，F 光（486 nm）焦点比 C 光（656 nm）近约 1.6 mm，即 f/ν（轴向色差）。下：N-BK7/F2 双胶合消色差透镜，F、C 两色焦点重合，剩余的是二级光谱。两块透镜焦距都约 100 mm，比较右侧两块光屏上的光斑。',
    view: { cx: 40, cy: 0, w: 300 },
    build: () => [
      E('beam', { x: -60, y: 35, w: 22, n: 11, white: true }),
      E('lens', { x: 0, y: 35, R1: 103.5, R2: -103.5, d: 5, D: 28, mat: 'K9' }),
      E('detector', { x: 100.9, y: 35, L: 16, pass: true }),
      E('beam', { x: -60, y: -35, w: 22, n: 11, white: true }),
      E('achromat', { x: 0, y: -35, R1: 44.444, R2: -42.447, R3: -826.165, d1: 5, d2: 2.5, D: 28, mat1: 'N-BK7', mat2: 'F2' }),
      E('detector', { x: 98.5, y: -35, L: 16, pass: true }),
    ],
  },
  {
    id: 'prism', title: '三棱镜色散 · 最小偏向角', note: '白光以钠黄光的最小偏向角入射 ZF1 重火石玻璃三棱镜，出射后分成连续光谱。转动三棱镜（选中后拖动轴向手柄）可找到偏向角最小的位置；用量尺测偏向角 δ，按 n = sin[(A+δ)/2]/sin(A/2) 算折射率。',
    view: { cx: 20, cy: 10, w: 300 },
    build: () => {
      const n = index('ZF1', 589.3), A = 60 * D2R;
      const dmin = 2 * Math.asin(n * Math.sin(A / 2)) - A, i1 = (dmin + A) / 2;
      // 左侧面外法线方位 150°（顶点朝上）；入射方向与内法线 (−30°) 夹角为 i1
      const dir = -30 * D2R + i1; // 光从左下方射入
      const hit = [-10, 5.77]; // 左侧面中点
      const L = 90;
      return [
        E('prism', { x: 0, y: 0, A: 60, a: 40, mat: 'ZF1' }),
        E('laser', { x: hit[0] - L * Math.cos(dir), y: hit[1] - L * Math.sin(dir), rot: dir * R2D, white: true }),
        E('detector', { x: 10 + 100 * Math.cos(dir - dmin), y: 5.77 + 100 * Math.sin(dir - dmin), rot: (dir - dmin) * R2D, L: 40 }),
      ];
    },
  },
  {
    id: 'tir', title: '全反射与光导纤维', note: 'K9 玻璃棒（n≈1.517）的临界角约 41.2°。从端面进入的光在侧壁上的入射角都大于临界角，被全反射约束在棒内传播。把棒换成水（n≈1.333）或减小棒的折射率，看看哪些光开始漏出。',
    view: { cx: 0, cy: 0, w: 420 },
    build: () => [
      E('point', { x: -172, y: 0, cone: 70, n: 25, lam: 532 }),
      E('block', { x: 0, y: 0, w: 320, h: 12, mat: 'K9' }),
      E('detector', { x: 175, y: 0, L: 30 }),
    ],
  },
  {
    id: 'rainbow', title: '彩虹：水滴中的折射与反射', note: '太阳光照射水滴，经一次内反射出射的光集中在与入射方向相反约 42°（红）到 40.6°（紫）的方向，即主虹；经两次内反射的形成副虹（约 50°–53°，色序相反）。开启“部分反射”时可以看到各级光线的强弱。',
    view: { cx: -10, cy: 0, w: 200 },
    opts: { partial: true },
    build: () => [
      E('beam', { x: -60, y: 0, w: 39.9, n: 90, white: true }),
      E('circle', { x: 0, y: 0, r: 20, mat: 'Water' }),
    ],
  },
  {
    id: 'kepler', title: '开普勒望远镜', note: '物镜 f₀≈200 mm、目镜 fₑ≈50 mm，两焦点重合时平行光入射、平行光出射。斜入射光束出射后的倾角放大约 f₀/fₑ = 4 倍；中间实像位于共同焦面上。',
    view: { cx: 120, cy: 0, w: 480 },
    build: () => [
      E('beam', { x: -60, y: 0, w: 30, n: 9, lam: 546.1 }),
      E('beam', { x: -60, y: 8, w: 30, n: 9, lam: 632.8, rot: -2 }),
      E('lens', { x: 0, y: 0, R1: 206, R2: -206, d: 6, D: 44, mat: 'K9' }),
      E('lens', { x: 252, y: 0, R1: 52, R2: -52, d: 6, D: 22, mat: 'K9' }),
    ],
  },
  {
    id: 'microscope', title: '显微镜', note: '物体放在物镜（f=16 mm）焦点外少许，经物镜成放大的中间实像，再由目镜（f=25 mm）当放大镜观察，出射为近似平行光。两个物点分别在轴上和离轴 1 mm 处。',
    view: { cx: 80, cy: 0, w: 280 },
    build: () => [
      E('point', { x: -18, y: 0, cone: 50, n: 15, lam: 546.1 }),
      E('point', { x: -18, y: 1, cone: 50, n: 15, lam: 632.8 }),
      E('ideal', { x: 0, y: 0, f: 16, D: 14 }),
      E('ideal', { x: 169, y: 0, f: 25, D: 24 }),
    ],
  },
  {
    id: 'newton', title: '牛顿反射望远镜', note: '抛物面主镜（f=300 mm）把平行光会聚到焦点，没有球差；45° 平面副镜把焦点折到镜筒侧面。副镜挡住了中央一部分光（中心遮拦）。把抛物面镜换成同焦距的球面镜，看边缘光线焦点的偏离。',
    view: { cx: 150, cy: 30, w: 460 },
    build: () => [
      E('beam', { x: -40, y: 0, w: 76, n: 25, lam: 550 }),
      E('paraMirror', { x: 300, y: 0, f: 300, D: 80 }),
      E('mirror', { x: 60, y: 0, L: 18, rot: -45 }),
      E('detector', { x: 60, y: 60, L: 20, rot: 90, pass: true }),
    ],
  },
  {
    id: 'grating', title: '光栅分光（分光计光路）', note: '白光经 600 线/mm 透射光栅衍射，再由焦距 150 mm 的会聚透镜聚到焦面上，形成按波长排列的光谱。缝宽为周期一半时偶数级缺级。可以把光栅换成三棱镜比较两种色散的方向与线性。',
    view: { cx: 80, cy: 30, w: 360 },
    build: () => [
      E('beam', { x: -60, y: 0, w: 8, n: 5, white: true }),
      E('grating', { x: 0, y: 0, L: 20, lpm: 600, duty: 0.5, maxOrder: 2 }),
      E('ideal', { x: 30, y: 0, f: 150, D: 220 }),
      E('detector', { x: 180, y: 0, L: 220 }),
    ],
  },
  {
    id: 'critical', title: '半圆柱玻璃砖：折射定律与临界角', note: '激光沿半径射向圆心，在弧面上不偏折，只在平面上折射。入射角接近 41.2° 时折射光贴着界面掠出，超过后发生全反射。选中激光器，拖动它的轴向手柄改变入射角。',
    view: { cx: 0, cy: 0, w: 220 },
    build: () => {
      const a = 39 * D2R; // 平面外法线为 −x；从玻璃内侧看，入射角 a
      return [
        E('semicircle', { x: 0, y: 0, r: 40, mat: 'K9' }),
        E('laser', { x: 70 * Math.cos(a), y: 70 * Math.sin(a), rot: 180 + a * R2D, lam: 632.8 }),
      ];
    },
  },
  {
    id: 'michelson', title: '迈克尔逊干涉仪光路', note: '分束镜把激光分成两路，分别经 M₁、M₂ 反射后在分束镜处重新汇合射向观察屏。这里只追迹几何光路；干涉条纹见“迈克尔逊干涉仪”实验。',
    view: { cx: 30, cy: 20, w: 300 },
    build: () => [
      E('laser', { x: -90, y: 0, lam: 632.8 }),
      E('splitter', { x: 0, y: 0, L: 24, rot: 135, R: 0.5 }),
      E('mirror', { x: 90, y: 0, L: 30, rot: 0 }),
      E('mirror', { x: 0, y: 80, L: 30, rot: 90 }),
      E('detector', { x: 0, y: -70, L: 40, rot: 90 }),
    ],
  },
  {
    id: 'camera', title: '照相镜头：双高斯结构', note: '按经典双高斯镜头（f=100 mm，f/3）的真实处方逐面追迹，玻璃色散取厂商 Sellmeier 系数。三束光的视场角为 0°、7°、14°；在像面上看各视场的弥散与色差。',
    view: { cx: 30, cy: 0, w: 260 },
    opts: { partial: false },
    build: () => {
      const L = LENSES['double-gauss'], par = paraxial(L), zv = vertices(L);
      const len = zv[zv.length - 1];
      const xi = -len / 2 + par.zImage;
      const out = [E('camera', { x: 0, y: 0, design: 'double-gauss', scale: 1 })];
      [0, 7, 14].forEach((th, i) => {
        const a = th * D2R, x0 = -90;
        out.push(E('beam', { x: x0, y: -Math.tan(a) * (-len / 2 + par.zEP - x0), rot: th, w: 33 * Math.cos(a), n: 11, white: true, power: 1 }));
        void i;
      });
      out.push(E('detector', { x: xi, y: 0, L: 60, pass: true }));
      return out;
    },
  },
  {
    id: 'slab', title: '平行平板的侧移与多次反射', note: '光斜射入平行平板玻璃，出射光与入射光平行但侧移；每个界面都有部分反射（约 4%），形成一串强度递减的平行光——这正是等倾干涉、法布里—珀罗干涉的几何基础。',
    view: { cx: 0, cy: 0, w: 260 },
    opts: { partial: true },
    build: () => [
      E('laser', { x: -90, y: 40, rot: -30, lam: 632.8 }),
      E('block', { x: 0, y: 0, w: 24, h: 120, mat: 'K9' }),
    ],
  },
];
