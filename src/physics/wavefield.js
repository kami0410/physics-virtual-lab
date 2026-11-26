// 标量衍射计算：二维复振幅光场在 N×N 网格上的传播（单位 mm）
//
// 接口仿照 LightPipes（https://github.com/opticspy/lightpipes，BSD-3-Clause，© LightPipes Developers；
// 源自 Gleb Vdovin 的 C 版 LightPipes）：先 begin() 生成平面波光场，再依次通过光阑、透镜等元件，最后传播到观察面。
// 本文件为 JavaScript 重新实现，未复制其代码。传播算法：
//   近场：带限角谱法（Matsushima & Shimobaba, Opt. Express 17, 19662 (2009)），传递函数取严格的
//         H = exp(i k z √(1 − (λfx)² − (λfy)²))，并按网格可采样的最大频率截断，避免周期边界的混叠；
//   远场：单次 FFT 菲涅耳变换，输出面像素 λz/L，网格随距离放大（相当于 LightPipes 的 Forvard/Fresnel 中远场情形）。
import { fft2, fft1d } from './fourier.js';

export class Field {
  /** N：网格点数（2 的幂）；size：网格边长 mm；lam：波长 mm */
  constructor(N, size, lam) {
    this.N = N; this.size = size; this.lam = lam;
    this.re = new Float64Array(N * N); this.im = new Float64Array(N * N);
  }
  get dx() { return this.size / this.N; }
  /** 网格点 (i, j) 的物理坐标：x = (j − N/2)·dx，y = (i − N/2)·dx */
  coord(k) { return (k - this.N / 2) * this.dx; }
  clone() { const f = new Field(this.N, this.size, this.lam); f.re.set(this.re); f.im.set(this.im); return f; }
}

/** 单位振幅平面波 */
export function begin(N, size, lam) { const F = new Field(N, size, lam); F.re.fill(1); return F; }

/**
 * 乘以透过率函数 t(x, y)（0~1）。用 ss×ss 子像素平均做抗锯齿，使圆孔边缘等不出现阶梯。
 * 透过率函数也可以返回复数 [re, im]（相位物体）。
 */
export function mask(F, t, ss = 3) {
  const N = F.N, dx = F.dx;
  for (let i = 0; i < N; i++) {
    const y = F.coord(i);
    for (let j = 0; j < N; j++) {
      const x = F.coord(j);
      let a = 0;
      for (let u = 0; u < ss; u++) for (let v = 0; v < ss; v++) a += t(x + ((u + 0.5) / ss - 0.5) * dx, y + ((v + 0.5) / ss - 0.5) * dx);
      a /= ss * ss;
      const k = i * N + j;
      F.re[k] *= a; F.im[k] *= a;
    }
  }
  return F;
}

// mask() 的快速等价形式（结果与 mask() 逐点相同）：
/** 只随 x 变化的透过率 t(x)（缝、光栅、直边）：算一行再复制 */
export function maskX(F, t, ss = 3) {
  const N = F.N, dx = F.dx, row = new Float64Array(N);
  for (let j = 0; j < N; j++) { const x = F.coord(j); let a = 0; for (let u = 0; u < ss; u++) for (let v = 0; v < ss; v++) a += t(x + ((u + 0.5) / ss - 0.5) * dx); row[j] = a / (ss * ss); }
  for (let i = 0; i < N; i++) for (let j = 0, k = i * N; j < N; j++, k++) { F.re[k] *= row[j]; F.im[k] *= row[j]; }
  return F;
}
/** 可分离的透过率 tx(x)·ty(y)（矩孔）：子像素平均也可分离 */
export function maskSep(F, tx, ty, ss = 3) {
  const N = F.N, dx = F.dx, px = new Float64Array(N), py = new Float64Array(N);
  for (let j = 0; j < N; j++) { const x = F.coord(j); let a = 0, b = 0; for (let u = 0; u < ss; u++) { const d = ((u + 0.5) / ss - 0.5) * dx; a += tx(x + d); b += ty(x + d); } px[j] = a / ss; py[j] = b / ss; }
  for (let i = 0; i < N; i++) for (let j = 0, k = i * N; j < N; j++, k++) { const m = py[i] * px[j]; F.re[k] *= m; F.im[k] *= m; }
  return F;
}
/** 只在半径 rEdge 附近不连续的旋转对称透过率 t(r)（圆孔、圆屏）：离边缘超过一个像素的点只取中心值 */
export function maskRadial(F, t, rEdge, ss = 3) {
  const N = F.N, dx = F.dx;
  for (let i = 0; i < N; i++) {
    const y = F.coord(i);
    for (let j = 0; j < N; j++) {
      const x = F.coord(j), r = Math.hypot(x, y);
      let a;
      if (Math.abs(r - rEdge) > dx) a = t(r);
      else { a = 0; for (let u = 0; u < ss; u++) for (let v = 0; v < ss; v++) a += t(Math.hypot(x + ((u + 0.5) / ss - 0.5) * dx, y + ((v + 0.5) / ss - 0.5) * dx)); a /= ss * ss; }
      const k = i * N + j; F.re[k] *= a; F.im[k] *= a;
    }
  }
  return F;
}

// 常用光阑（与 LightPipes 同名的含义）
export const circAperture = (F, R, x0 = 0, y0 = 0) => mask(F, (x, y) => ((x - x0) ** 2 + (y - y0) ** 2 <= R * R ? 1 : 0));
export const circScreen = (F, R, x0 = 0, y0 = 0) => mask(F, (x, y) => ((x - x0) ** 2 + (y - y0) ** 2 <= R * R ? 0 : 1));
export const rectAperture = (F, wx, wy, x0 = 0, y0 = 0) => mask(F, (x, y) => (Math.abs(x - x0) <= wx / 2 && Math.abs(y - y0) <= wy / 2 ? 1 : 0));
export const rectScreen = (F, wx, wy, x0 = 0, y0 = 0) => mask(F, (x, y) => (Math.abs(x - x0) <= wx / 2 && Math.abs(y - y0) <= wy / 2 ? 0 : 1));

/** 理想薄透镜：乘以 exp(−ik r²/2f) */
export function lens(F, f, x0 = 0, y0 = 0) { return phase(F, (x, y) => (-Math.PI / (F.lam * f)) * ((x - x0) ** 2 + (y - y0) ** 2)); }
/** 发散球面波照明（点光源在 R 处）：乘以 exp(ik r²/2R) */
export function spherical(F, R) { return R > 0 && isFinite(R) ? phase(F, (x, y) => (Math.PI / (F.lam * R)) * (x * x + y * y)) : F; }
export function phase(F, ph) {
  const N = F.N;
  for (let i = 0; i < N; i++) {
    const y = F.coord(i);
    for (let j = 0; j < N; j++) {
      const k = i * N + j, p = ph(F.coord(j), y), c = Math.cos(p), s = Math.sin(p);
      const r = F.re[k], m = F.im[k];
      F.re[k] = r * c - m * s; F.im[k] = r * s + m * c;
    }
  }
  return F;
}

/** 带限角谱法传播 z（mm），网格不变 */
export function angularSpectrum(F, z) {
  const N = F.N, L = F.size, lam = F.lam;
  const re = F.re, im = F.im;
  fft2(re, im, N, false);
  const df = 1 / L;
  // 带限：|fx| ≤ 1/(λ√((2Δf z)² + 1))
  const fLim = 1 / (lam * Math.sqrt((2 * df * z) ** 2 + 1));
  const k2 = 1 / (lam * lam);
  for (let i = 0; i < N; i++) {
    const fy = (i < N / 2 ? i : i - N) * df;
    for (let j = 0; j < N; j++) {
      const fx = (j < N / 2 ? j : j - N) * df;
      const k = i * N + j;
      const q = k2 - fx * fx - fy * fy;
      if (q <= 0 || Math.abs(fx) > fLim || Math.abs(fy) > fLim) { re[k] = 0; im[k] = 0; continue; } // 倏逝波与超出带限的部分
      const p = 2 * Math.PI * z * Math.sqrt(q);
      const c = Math.cos(p), s = Math.sin(p), r = re[k], m = im[k];
      re[k] = r * c - m * s; im[k] = r * s + m * c;
    }
  }
  fft2(re, im, N, true);
  return F;
}

/**
 * 单次 FFT 菲涅耳衍射：U(x′) = e^{ikz}/(iλz) · e^{ikx′²/2z} · FT[U(x) e^{ikx²/2z}]，输出网格边长 λzN/L。
 * 返回新的 Field（size 改变）。适合 z 大于 N·dx²/λ 的情形。
 */
export function fresnelFar(F, z) {
  const N = F.N, L = F.size, lam = F.lam, dx = F.dx;
  const G = F.clone();
  phase(G, (x, y) => (Math.PI / (lam * z)) * (x * x + y * y));
  // 中心化：FT 前后各做一次 (−1)^(i+j) 调制，使零频位于网格中心
  const chk = (H) => { for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if ((i + j) & 1) { const k = i * N + j; H.re[k] = -H.re[k]; H.im[k] = -H.im[k]; } };
  chk(G);
  fft2(G.re, G.im, N, false);
  chk(G);
  const L2 = (lam * z * N) / L;
  const out = new Field(N, L2, lam);
  const scale = (dx * dx) / (lam * z); // |1/(iλz)|·dx²
  out.re.set(G.re); out.im.set(G.im);
  phase(out, (x, y) => (Math.PI / (lam * z)) * (x * x + y * y));
  for (let k = 0; k < N * N; k++) { out.re[k] *= scale; out.im[k] *= scale; }
  return out;
}

/** 自动选择：z ≤ N·dx²/λ 用角谱法（输出网格与输入相同），否则用单次 FFT 菲涅耳变换 */
export function propagate(F, z) {
  const zc = (F.N * F.dx * F.dx) / F.lam;
  if (z <= zc) return { F: angularSpectrum(F, z), method: 'asm' };
  return { F: fresnelFar(F, z), method: 'fresnel' };
}

/**
 * 一维版本：透过率只随 x 变化（单缝、光栅等，沿 y 无限长）的平面波传播 z（mm）。
 * 沿 y 均匀的光场经二维传播后仍沿 y 均匀，各行只差一个常数因子，所以只算一行，结果与
 * begin → mask → propagate 取中间一行相同（相差常数因子），计算量少 N 倍。
 * 返回 { re, im, dx }：观察面一行的复振幅与像素间距（菲涅耳远场时 dx = λz/L，随 z 放大）。
 */
export function propagateRow(N, L, lam, t, z, ss = 3) {
  const dx = L / N, re = new Float64Array(N), im = new Float64Array(N);
  for (let j = 0; j < N; j++) { const x = (j - N / 2) * dx; let a = 0; for (let u = 0; u < ss; u++) a += t(x + ((u + 0.5) / ss - 0.5) * dx); re[j] = a / ss; }
  if (z <= (L * L) / (N * lam)) { // 带限角谱法，与 angularSpectrum() 相同（只取 fy = 0）
    fft1d(re, im, N, false);
    const df = 1 / L, fLim = 1 / (lam * Math.sqrt((2 * df * z) ** 2 + 1)), k2 = 1 / (lam * lam);
    for (let j = 0; j < N; j++) {
      const fx = (j < N / 2 ? j : j - N) * df, q = k2 - fx * fx;
      if (q <= 0 || Math.abs(fx) > fLim) { re[j] = 0; im[j] = 0; continue; }
      const p = 2 * Math.PI * z * Math.sqrt(q), c = Math.cos(p), s = Math.sin(p), r = re[j], m = im[j];
      re[j] = r * c - m * s; im[j] = r * s + m * c;
    }
    fft1d(re, im, N, true);
    return { re, im, dx };
  }
  // 单次 FFT 菲涅耳变换，与 fresnelFar() 相同
  const chirp = (d) => { for (let j = 0; j < N; j++) { const x = (j - N / 2) * d, p = (Math.PI / (lam * z)) * x * x, c = Math.cos(p), s = Math.sin(p), r = re[j], m = im[j]; re[j] = r * c - m * s; im[j] = r * s + m * c; } };
  const chk = () => { for (let j = 1; j < N; j += 2) { re[j] = -re[j]; im[j] = -im[j]; } };
  chirp(dx); chk(); fft1d(re, im, N, false); chk();
  const dx2 = (lam * z) / L, scale = dx / Math.sqrt(lam * z);
  chirp(dx2);
  for (let j = 0; j < N; j++) { re[j] *= scale; im[j] *= scale; }
  return { re, im, dx: dx2 };
}

/** 光强 |U|² */
export function intensity(F) {
  const I = new Float64Array(F.N * F.N);
  for (let k = 0; k < I.length; k++) I[k] = F.re[k] * F.re[k] + F.im[k] * F.im[k];
  return I;
}

// ---------------------------------------------------------------- 部分相干
// 扩展的非相干光源：傍轴菲涅耳衍射中，横移 xₛ 的点光源（距离 R）产生的光强图样，恰好是轴上点光源图样平移 xₛ·z/R。
// 所以整个光源的图样 = 轴上点光源的图样 与 “光源经孔径中心投影到观察屏上的像” 的卷积（各点非相干、光强相加）。

/** 光强图样与宽度 w（像素）的线光源（沿 x 的均匀条）卷积：用前缀和，O(N²) */
export function blurLine(I, N, w) {
  if (!(w > 0.5)) return I;
  const out = new Float64Array(N * N), half = w / 2, row = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) {
    const b = i * N;
    for (let j = 0; j < N; j++) row[j + 1] = row[j] + I[b + j];
    for (let j = 0; j < N; j++) {
      // 以像素 j 的中心为中点、宽 w 的区间，两端按小数部分线性取值
      const lo = Math.max(0, j + 0.5 - half), hi = Math.min(N, j + 0.5 + half);
      const l0 = Math.floor(lo), h0 = Math.floor(hi);
      let s = row[h0] - row[l0];
      if (h0 < N) s += (hi - h0) * I[b + h0];
      s -= (lo - l0) * I[b + l0];
      out[b + j] = s / (hi - lo);
    }
  }
  return out;
}

/** 光强图样与半径 r（像素）的均匀圆盘卷积（圆形光源）：FFT 卷积 */
export function blurDisk(I, N, r) {
  if (!(r > 0.5)) return I;
  const re = Float64Array.from(I), im = new Float64Array(N * N);
  const kr = new Float64Array(N * N), ki = new Float64Array(N * N);
  let sum = 0;
  const R = Math.ceil(r + 1);
  for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
    // 边缘像素按覆盖面积近似（距离在 r ± 0.5 之间线性过渡）
    const w = Math.min(1, Math.max(0, r + 0.5 - Math.hypot(x, y)));
    if (!w) continue;
    kr[((y + N) % N) * N + ((x + N) % N)] += w; sum += w;
  }
  for (let k = 0; k < N * N; k++) kr[k] /= sum;
  fft2(re, im, N, false); fft2(kr, ki, N, false);
  for (let k = 0; k < N * N; k++) { const a = re[k], b = im[k]; re[k] = a * kr[k] - b * ki[k]; im[k] = a * ki[k] + b * kr[k]; }
  fft2(re, im, N, true);
  for (let k = 0; k < N * N; k++) re[k] = Math.max(0, re[k]);
  return re;
}

/** 高斯谱线：中心 lam（nm），半高全宽 fwhm（nm），取 n 个波长及其权重（权重和为 1） */
export function spectrumSamples(lam, fwhm, n = 7) {
  if (!(fwhm > 0)) return [{ nm: lam, w: 1 }];
  const sig = fwhm / 2.3548, out = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    const t = -2 + (4 * i) / (n - 1), w = Math.exp(-0.5 * t * t);
    out.push({ nm: lam + t * sig, w }); s += w;
  }
  for (const o of out) o.w /= s;
  return out;
}
