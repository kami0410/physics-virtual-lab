// 数据采集的基本信号处理：量化、混叠、频谱峰值、正弦拟合
// 量化：双极性 ±V_max、n 位，LSB = 2V_max/2ⁿ，四舍五入到最近的码，超量程时截在满码。
// 混叠：以 f_s 采样频率为 f 的正弦，频谱上看到的频率是 |f − f_s·round(f/f_s)|（落在 0–f_s/2）。
// 频谱：汉宁窗 + 基 2 FFT，峰值频率用对数幅度的三点抛物线插值（误差远小于一个频率分辨率）。
// 正弦拟合：已知频率的三参数最小二乘（IEEE 1057），残差的均方根即量化噪声与模拟噪声之和。

export const lsb = (bits, vmax = 5) => (2 * vmax) / 2 ** bits;
export function quantize(v, bits, vmax = 5) {
  const q = lsb(bits, vmax), h = 2 ** (bits - 1);
  return Math.max(-h, Math.min(h - 1, Math.round(v / q))) * q;
}
export const aliasFreq = (f, fs) => Math.abs(f - fs * Math.round(f / fs));

/** 原位基 2 FFT */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/** 单边幅度谱（汉宁窗，已按窗的相干增益归一化为正弦峰值）与最强峰的频率 */
export function spectrum(x, fs) {
  const n = x.length, re = new Float64Array(n), im = new Float64Array(n);
  let m = 0; for (const v of x) m += v; m /= n;
  for (let i = 0; i < n; i++) re[i] = (x[i] - m) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  fft(re, im);
  const mag = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) mag[k] = (4 / n) * Math.hypot(re[k], im[k]);
  // 峰可以一直到 Nyquist 频率（k = n/2 − 1 为最后一格）；插值时越界的一侧按对称处理
  let kp = 1; for (let k = 2; k < n / 2; k++) if (mag[k] > mag[kp]) kp = k;
  const at = (k) => mag[k < 0 ? -k : k >= n / 2 ? n - 2 - k : k];
  const a = Math.log(at(kp - 1) + 1e-30), b = Math.log(mag[kp] + 1e-30), c = Math.log(at(kp + 1) + 1e-30);
  const d = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / (a - 2 * b + c || 1e-30)));
  return { mag, df: fs / n, peak: (kp + d) * (fs / n), amp: mag[kp] };
}

/** 已知频率的三参数正弦拟合：x ≈ A cos ωt + B sin ωt + C，返回残差均方根 */
export function sineFit(x, f, fs) {
  const n = x.length, w = (2 * Math.PI * f) / fs;
  let scc = 0, sss = 0, scs = 0, sc = 0, ss = 0, sxc = 0, sxs = 0, sx = 0;
  for (let i = 0; i < n; i++) { const c = Math.cos(w * i), s = Math.sin(w * i), v = x[i]; scc += c * c; sss += s * s; scs += c * s; sc += c; ss += s; sxc += v * c; sxs += v * s; sx += v; }
  // 解 3×3 正规方程（克莱姆法则）
  const M = [[scc, scs, sc], [scs, sss, ss], [sc, ss, n]], y = [sxc, sxs, sx];
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M), col = (j) => M.map((r, i) => r.map((v, k) => (k === j ? y[i] : v)));
  // f 为 fs/2 的整数倍时 sin ωt 在采样点上恒为 0（f = fs 时 cos 也恒为 1）：正规方程奇异，退化为少一个参数的拟合
  if (Math.abs(D) < 1e-9 * Math.abs(scc * sss * n || 1)) {
    const alias = Math.abs(Math.cos(w) - 1) < 1e-9; // f 是 fs 的整数倍：信号在采样点上就是常数
    const A = alias ? 0 : (sxc * n - sc * sx) / (scc * n - sc * sc || 1e-30), C = alias ? sx / n : (sx - A * sc) / n;
    let e2 = 0; for (let i = 0; i < n; i++) { const r = x[i] - (A * Math.cos(w * i) + C); e2 += r * r; }
    return { amp: Math.abs(A), C, rms: Math.sqrt(e2 / n), degenerate: true };
  }
  const A = det(col(0)) / D, B = det(col(1)) / D, C = det(col(2)) / D;
  let e2 = 0; for (let i = 0; i < n; i++) { const r = x[i] - (A * Math.cos(w * i) + B * Math.sin(w * i) + C); e2 += r * r; }
  return { amp: Math.hypot(A, B), C, rms: Math.sqrt(e2 / n) };
}
