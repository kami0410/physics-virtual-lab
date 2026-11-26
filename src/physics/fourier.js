// 二维快速傅里叶变换（基 2，原位，Float64Array 实部/虚部分开存放），用于阿贝成像与空间滤波
const cache = new Map();

function tables(n) {
  if (cache.has(n)) return cache.get(n);
  const bits = Math.log2(n);
  if (bits % 1) throw new Error('FFT size must be a power of 2');
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = Math.sin((2 * Math.PI * i) / n); }
  const t = { rev, cos, sin };
  cache.set(n, t);
  return t;
}

/** 一维 FFT：对 re/im 中从 off 开始、步长 stride 的 n 个元素做变换；inv=true 为逆变换（不归一化） */
function fft1(re, im, off, stride, n, inv, bufR, bufI) {
  const { rev, cos, sin } = tables(n);
  for (let i = 0; i < n; i++) { const j = off + rev[i] * stride; bufR[i] = re[j]; bufI[i] = im[j]; }
  const sg = inv ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let s = 0; s < n; s += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step], wi = sg * sin[k * step];
        const a = s + k, b = a + half;
        const xr = bufR[b] * wr - bufI[b] * wi, xi = bufR[b] * wi + bufI[b] * wr;
        bufR[b] = bufR[a] - xr; bufI[b] = bufI[a] - xi;
        bufR[a] += xr; bufI[a] += xi;
      }
    }
  }
  for (let i = 0; i < n; i++) { const j = off + i * stride; re[j] = bufR[i]; im[j] = bufI[i]; }
}

/** 二维 FFT（行优先，n×n）。inv=true 时做逆变换并除以 n² */
export function fft2(re, im, n, inv = false) {
  const bR = new Float64Array(n), bI = new Float64Array(n);
  for (let y = 0; y < n; y++) fft1(re, im, y * n, 1, n, inv, bR, bI);
  for (let x = 0; x < n; x++) fft1(re, im, x, n, n, inv, bR, bI);
  if (inv) { const s = 1 / (n * n); for (let i = 0; i < n * n; i++) { re[i] *= s; im[i] *= s; } }
}

/** 一维 FFT（长度 n，原位）。inv=true 时做逆变换并除以 n */
export function fft1d(re, im, n, inv = false) {
  fft1(re, im, 0, 1, n, inv, new Float64Array(n), new Float64Array(n));
  if (inv) { const s = 1 / n; for (let i = 0; i < n; i++) { re[i] *= s; im[i] *= s; } }
}

/** 频率下标 → 有符号频率序号（0..n/2-1, -n/2..-1） */
export const fIdx = (i, n) => (i < n / 2 ? i : i - n);
