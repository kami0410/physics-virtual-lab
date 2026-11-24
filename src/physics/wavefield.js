// 标量衍射计算：二维复振幅光场在 N×N 网格上的传播（单位 mm）
//
// 接口仿照 LightPipes（https://github.com/opticspy/lightpipes，BSD-3-Clause，© LightPipes Developers；
// 源自 Gleb Vdovin 的 C 版 LightPipes）：先 begin() 生成平面波光场，再依次通过光阑、透镜等元件，最后传播到观察面。
// 本文件为 JavaScript 重新实现，未复制其代码。传播算法：
//   近场：带限角谱法（Matsushima & Shimobaba, Opt. Express 17, 19662 (2009)），传递函数取严格的
//         H = exp(i k z √(1 − (λfx)² − (λfy)²))，并按网格可采样的最大频率截断，避免周期边界的混叠；
//   远场：单次 FFT 菲涅耳变换，输出面像素 λz/L，网格随距离放大（相当于 LightPipes 的 Forvard/Fresnel 中远场情形）。
import { fft2 } from './fourier.js';

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

/** 光强 |U|² */
export function intensity(F) {
  const I = new Float64Array(F.N * F.N);
  for (let k = 0; k < I.length; k++) I[k] = F.re[k] * F.re[k] + F.im[k] * F.im[k];
  return I;
}
