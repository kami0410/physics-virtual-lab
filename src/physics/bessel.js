/** 整数阶贝塞尔函数 J_n(x)（级数，|x| < 8 足够精确） */
export function besselJ(n, x) {
  const m = Math.abs(n);
  let s = 0, term = Math.pow(x / 2, m);
  for (let j = 1; j <= m; j++) term /= j;
  for (let k = 0; k < 40; k++) {
    s += term;
    term *= -(x * x) / 4 / ((k + 1) * (k + 1 + m));
    if (Math.abs(term) < 1e-14) break;
  }
  return n < 0 && m % 2 ? -s : s;
}
