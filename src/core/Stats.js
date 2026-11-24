// 数据处理核心：最小二乘拟合、不确定度评定、逐差法、有效数字
// 全部自主实现，不依赖第三方数值库。

export const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

/** 样本标准差 S(x) */
export function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

/** t 因子 (置信概率 0.683)，n 为测量次数 */
export function tFactor(n) {
  const t = { 2: 1.84, 3: 1.32, 4: 1.20, 5: 1.14, 6: 1.11, 7: 1.09, 8: 1.08, 9: 1.07, 10: 1.06 };
  return t[n] || 1.0;
}

/** A 类不确定度：平均值的标准偏差 */
export function uA(a) {
  if (a.length < 2) return 0;
  return stdev(a) / Math.sqrt(a.length);
}

/** 一元线性最小二乘 y = k x + b，返回斜率、截距及其标准不确定度、相关系数 */
export function linFit(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = mean(xs), my = mean(ys);
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
    syy += (ys[i] - my) ** 2;
  }
  const k = sxy / sxx;
  const b = my - k * mx;
  const r = sxy / Math.sqrt(sxx * syy || 1e-300);
  let s = 0;
  for (let i = 0; i < n; i++) s += (ys[i] - (k * xs[i] + b)) ** 2;
  const sy = n > 2 ? Math.sqrt(s / (n - 2)) : 0;
  const uk = sy / Math.sqrt(sxx);
  const ub = sy * Math.sqrt(1 / n + mx * mx / sxx);
  return { k, b, uk, ub, r, sy, n };
}

/** 过原点拟合 y = k x */
export function propFit(xs, ys) {
  let sxx = 0, sxy = 0;
  for (let i = 0; i < xs.length; i++) { sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
  const k = sxy / sxx;
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += (ys[i] - k * xs[i]) ** 2;
  const sy = xs.length > 1 ? Math.sqrt(s / (xs.length - 1)) : 0;
  return { k, uk: sy / Math.sqrt(sxx) };
}

/** 逐差法：把 n=2m 个等间隔数据分成前后两组对应相减，返回差值数组 */
export function successiveDiff(a) {
  const m = Math.floor(a.length / 2);
  const out = [];
  for (let i = 0; i < m; i++) out.push(a[i + m] - a[i]);
  return out;
}

/** 按不确定度保留有效数字：不确定度取 1~2 位，测量值末位与之对齐 */
export function fmtU(value, u, unit = '') {
  if (!isFinite(value)) return '—';
  if (!u || !isFinite(u) || u <= 0) return `${sig(value, 5)}${unit ? ' ' + unit : ''}`;
  const e = Math.floor(Math.log10(u));
  const lead = u / 10 ** e;
  const digitsExp = lead < 3 ? e - 1 : e; // 首位为1、2时保留两位
  const dec = Math.max(0, -digitsExp);
  const uR = Math.ceil(u / 10 ** digitsExp - 1e-9) * 10 ** digitsExp;
  return `(${value.toFixed(dec)} ± ${uR.toFixed(dec)})${unit ? ' ' + unit : ''}`;
}

/** 用于 KaTeX 的测量结果：(x \pm u)\,\mathrm{unit} */
export function texU(value, u, unit = '') {
  const s = fmtU(value, u).replace('±', '\\pm');
  return s + (unit ? `\\,\\mathrm{${unit}}` : '');
}

export function sig(v, n = 4) {
  if (!isFinite(v)) return '—';
  if (v === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(v)));
  const dec = Math.max(0, n - 1 - e);
  return dec > 10 ? v.toExponential(n - 1) : v.toFixed(dec);
}

export const relErr = (v, ref) => Math.abs(v - ref) / Math.abs(ref);
export const pct = (x, d = 2) => (x * 100).toFixed(d) + '%';

/** 高斯随机数 */
export function gauss(sigma = 1) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
export const rand = (a, b) => a + Math.random() * (b - a);
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;

/** 角度格式化：十进制度 -> 度分 */
export function dms(deg) {
  let d = ((deg % 360) + 360) % 360;
  let D = Math.floor(d);
  let M = Math.round((d - D) * 60);
  if (M === 60) { D += 1; M = 0; }
  return `${D % 360}°${String(M).padStart(2, '0')}′`;
}
/** 解析 "123°45′" / "123 45" / "123.75" */
export function parseDms(s) {
  if (typeof s === 'number') return s;
  if (s == null) return NaN;
  const str = String(s).trim();
  const m = str.match(/^(-?\d+(?:\.\d+)?)\s*[°度\s]\s*(\d+(?:\.\d+)?)?\s*[′'分]?\s*$/);
  if (m) return parseFloat(m[1]) + (m[2] ? parseFloat(m[2]) / 60 : 0);
  return parseFloat(str);
}
