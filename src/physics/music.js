// 乐音的物理：十二平均律、拨弦的谐波、汉宁窗频谱
// 1. 十二平均律：相邻半音频率比 2^(1/12)，以 A4 = 440 Hz 为标准音。纯律的大音阶取简单整数比。
// 2. 拨弦：在离端点 x₀ 处把弦拉成三角形后放开，第 n 个模式的初始振幅 ∝ sin(nπx₀/L)/n²；
//    弦通过琴码推动音箱，声压正比于琴码处的横向力 T·∂y/∂x，所以 n 次谐波的声压 ∝ sin(nπx₀/L)/n。
//    钢丝的抗弯刚度使泛音略高于整数倍：fₙ = n f₁ √(1 + Bn²)/√(1 + B)，B = π³Ed⁴/(64TL²)。
// 3. 加汉宁窗、时长 T 的单频信号的频谱幅值（相对峰值）：|sinc(x)/(1 − x²)|，x = (f − f₀)T。

export const NOTE_NAMES = ['C4', 'C♯4', 'D4', 'D♯4', 'E4', 'F4', 'F♯4', 'G4', 'G♯4', 'A4', 'A♯4', 'B4', 'C5'];
/** C4 起第 k 个半音的平均律频率 */
export const noteFreq = (k) => 440 * 2 ** ((k - 9) / 12);
/** C 大调音阶：半音数与纯律比 */
export const MAJOR = [
  { name: 'C4', solfa: 'do', k: 0, just: [1, 1] },
  { name: 'D4', solfa: 're', k: 2, just: [9, 8] },
  { name: 'E4', solfa: 'mi', k: 4, just: [5, 4] },
  { name: 'F4', solfa: 'fa', k: 5, just: [4, 3] },
  { name: 'G4', solfa: 'sol', k: 7, just: [3, 2] },
  { name: 'A4', solfa: 'la', k: 9, just: [5, 3] },
  { name: 'B4', solfa: 'si', k: 11, just: [15, 8] },
  { name: 'C5', solfa: 'do', k: 12, just: [2, 1] },
];
export const cents = (f, f0) => 1200 * Math.log2(f / f0);

/** 拨弦（位置 r = x₀/L）第 n 次谐波的声压相对基波（线性） */
export function pluckRel(n, r) { return Math.abs(Math.sin(n * Math.PI * r)) / (n * Math.abs(Math.sin(Math.PI * r))); }

/** 汉宁窗频谱的主瓣形状：x = Δf·T */
export function hannMag(x) {
  const ax = Math.abs(x);
  if (ax < 1e-9) return 1;
  if (Math.abs(ax - 1) < 1e-9) return 0.5;
  return Math.abs(Math.sin(Math.PI * x) / (Math.PI * x * (1 - x * x)));
}

/** 指数衰减分量在 [t1, t1+T] 窗内的平均振幅因子 */
export function decayAvg(tau, t1, T) { return (tau / T) * Math.exp(-t1 / tau) * (1 - Math.exp(-T / tau)); }
