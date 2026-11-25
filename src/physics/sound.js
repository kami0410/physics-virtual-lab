// 空气中的声速与超声换能器之间的声场。
// 声速：v = 331.45·√(1 + t/273.15)·√(1 + 0.3192·p_w/p)，p_w 为水蒸气分压（Magnus 公式求饱和蒸气压）。
// 接收信号：发射面与接收面之间来回反射，接收端的声压是各次反射波的叠加
//   s = Σ R^{2m}·g(L_m)·e^{−ikL_m}，L_m = (2m+1)L，g(L) = e^{−αL}/(1 + L/x₀)（近似的扩散与吸收）
// 所以接收振幅在 L = nλ/2 处出现极大（驻波），相位随 L 每增加 λ 变化 2π。
// 换能器是压电陶瓷谐振器，频率响应 H(f) = 1/(1 + jQ(f/f₀ − f₀/f))。

export function satVaporP(T) { return 610.94 * Math.exp((17.625 * T) / (T + 243.04)); }

/** 空气声速 m/s。T：摄氏温度；RH：相对湿度 0–1；p：大气压 Pa */
export function soundSpeed(T, RH = 0, p = 101325) {
  const pw = RH * satVaporP(T);
  return 331.45 * Math.sqrt(1 + T / 273.15) * Math.sqrt(1 + (0.3192 * pw) / p);
}

const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];

/** 换能器频率响应（复数） */
export function transducer(f, f0, Q) {
  const y = Q * (f / f0 - f0 / f), d = 1 + y * y;
  return [1 / d, -y / d];
}

/** 两端面相距 L（m）时接收端的复振幅（不含换能器响应） */
export function cavity({ f, L, v, R = 0.5, x0 = 0.015, alpha = 0.15, n = 8 }) {
  const k = (2 * Math.PI * f) / v;
  let re = 0, im = 0;
  for (let m = 0; m < n; m++) {
    const Lm = (2 * m + 1) * L, a = R ** (2 * m) * Math.exp(-alpha * Lm) / (1 + Lm / x0);
    re += a * Math.cos(k * Lm); im -= a * Math.sin(k * Lm);
  }
  return [re, im];
}

/** 接收换能器输出（复数，相对驱动电压） */
export function received(o, tr1, tr2) { return cmul(cmul(transducer(o.f, tr1.f0, tr1.Q), transducer(o.f, tr2.f0, tr2.Q)), cavity(o)); }
