// 双踪示波器的扫描、触发与 X-Y 显示逻辑（不依赖 three.js / DOM，可在 node 里测试）
// 信号来自 spice.js 求出的周期稳态（signal.at(name, t)），时间轴与真实时间同步：
// 每一帧把这一帧时间里发生的扫描画到荧光屏缓冲上——触发稳定时各次扫描重合，图形静止；
// 不同步的通道、AUTO 下找不到触发点时，各次扫描起点不同，图形就会晃动、重叠，和真实仪器一样。
// 亮度按电子束在每段轨迹上的停留时间计算（思路参考 woscope，MIT），陡峭的边沿因此较暗。

export const VDIV = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5];
export const TDIV = [0.1e-6, 0.2e-6, 0.5e-6, 1e-6, 2e-6, 5e-6, 10e-6, 20e-6, 50e-6, 0.1e-3, 0.2e-3, 0.5e-3, 1e-3, 2e-3, 5e-3, 10e-3, 20e-3, 50e-3, 0.1, 0.2, 0.5];
export const fmtV = (v) => (v >= 1 ? `${v} V` : `${+(v * 1000).toPrecision(3)} mV`);
export const fmtT = (t) => (t >= 1e-3 ? `${+(t * 1e3).toPrecision(3)} ms` : t >= 1e-6 ? `${+(t * 1e6).toPrecision(3)} μs` : `${+(t * 1e9).toPrecision(3)} ns`);

export function defaultSettings() {
  return {
    power: true, inten: 0.65, focus: 0.5,
    mode: 'CH1',
    ch: [{ vdiv: 7, var: 1, pos: 0, cpl: 'DC', inv: false }, { vdiv: 7, var: 1, pos: 0, cpl: 'DC', inv: false }],
    tdiv: 11, tvar: 1, xpos: 0, mag: false,
    trig: { src: 0, level: 0, slope: 1, mode: 'AUTO' },
  };
}

const SWEEP_N = 400; // 每次扫描的采样点数
const K_MAX = 12; // 每帧最多画的扫描次数（更多时随机抽样，亮度按比例补偿）
const AUTO_T = 0.1; // AUTO 方式：等待触发超过这个时间就自激扫描

export class ScopeEngine {
  constructor(settings = defaultSettings()) {
    this.s = settings;
    this.sig = null;
    this.cur = null; // 正在进行的扫描的起点
    this.free = null; // 下一次扫描最早可开始的时刻
    this._tc = null; // 触发点相位缓存
    this.gain = [1, 1]; // 各通道垂直放大的实际增益/标称增益（仪器误差）
    this.tcal = 1; // 实际扫描时间/标称值
  }
  setSignal(sig) { this.sig = sig; this._tc = null; }
  vEff(c) { const ch = this.s.ch[c]; return VDIV[ch.vdiv] / ch.var; }
  tEff() { return TDIV[this.s.tdiv] / this.s.tvar; }
  uncal() { const s = this.s; return { y: s.ch.map((c) => c.var < 0.999), x: s.tvar < 0.999 }; }
  v(c, t) { return this.sig ? this.sig.at(c ? 'ch2' : 'ch1', t) : 0; }
  /** 通道 c 在 t 时刻的垂直偏转（格，屏幕中心为 0） */
  y(c, t) { const ch = this.s.ch[c]; const v = this.v(c, t); return ((ch.inv ? -v : v) * this.gain[c]) / this.vEff(c) + ch.pos; }

  // ---------------- 触发 ----------------
  trigLevel() { return (this.s.trig.level * this.vEff(this.s.trig.src)) / this.gain[this.s.trig.src]; }
  /** 单一频率信号：预先求出一个周期内所有触发点的相位 */
  trigCache() {
    const s = this.s, name = s.trig.src ? 'ch2' : 'ch1', L = this.trigLevel(), sl = s.trig.slope;
    const key = `${name}|${L}|${sl}`;
    if (this._tc && this._tc.key === key) return this._tc;
    const sig = this.sig, tc = { key, mode: 'none' };
    if (sig) {
      const live = sig.groups.filter((g) => { const d = g.data[name]; let mn = Infinity, mx = -Infinity; for (let i = 0; i < d.length; i += 7) { mn = Math.min(mn, d[i]); mx = Math.max(mx, d[i]); } return mx - mn > 1e-9; });
      if (live.length === 1) {
        const g = live[0], d = g.data[name], n = d.length, dc = sig.at(name, 0) - d[0]; // 直流 + 其他（不变的）分量
        const ph = [];
        for (let i = 0; i < n; i++) {
          const a = d[i] + dc, b = d[(i + 1) % n] + dc;
          if (sl > 0 ? a < L && b >= L : a > L && b <= L) ph.push((i + (L - a) / (b - a)) / n);
        }
        Object.assign(tc, { mode: 'periodic', T: g.T, ph });
      } else if (live.length > 1) {
        Object.assign(tc, { mode: 'scan', h: Math.min(...live.map((g) => g.T)) / 600, W: 2.2 * Math.max(...live.map((g) => g.T)) });
      }
    }
    return (this._tc = tc);
  }
  /** t 之后（含）第一个触发点；window 内找不到返回 null */
  nextTrigger(t, window = AUTO_T) {
    const tc = this.trigCache();
    if (tc.mode === 'periodic') {
      if (!tc.ph.length) return null;
      const k = Math.floor(t / tc.T);
      for (let j = 0; j < 2; j++) for (const p of tc.ph) { const tt = (k + j + p) * tc.T; if (tt >= t) return tt - t <= window ? tt : null; }
      return null;
    }
    if (tc.mode === 'scan') {
      const name = this.s.trig.src ? 'ch2' : 'ch1', L = this.trigLevel(), sl = this.s.trig.slope;
      const W = Math.min(window, tc.W), steps = Math.min(20000, Math.ceil(W / tc.h));
      let a = this.sig.at(name, t);
      for (let i = 1; i <= steps; i++) {
        const tt = t + i * tc.h, b = this.sig.at(name, tt);
        if (sl > 0 ? a < L && b >= L : a > L && b <= L) return tt - tc.h + (tc.h * (L - a)) / (b - a);
        a = b;
      }
    }
    return null;
  }
  /** 在 t 之后开始的下一次扫描的起点（NORM 方式没有触发时返回 null） */
  startAfter(t) {
    const tr = this.nextTrigger(t);
    if (tr != null) return tr;
    return this.s.trig.mode === 'AUTO' ? t : null;
  }
  get triggered() { return this._lastTrig === true; }

  // ---------------- 每帧 ----------------
  /**
   * 计算 [t0, t1] 这段时间里电子束扫过的轨迹，emit({pts:[x,y,…](格), ref, w}) 逐条输出。
   * ref：亮度参考段长（格），w：亮度权重
   */
  frame(t0, t1, emit) {
    const s = this.s;
    if (!s.power || !this.sig) return;
    if (s.mode === 'XY') return this.frameXY(t0, t1, emit);
    const tE = this.tEff() * this.tcal, Ts = 10 * tE, hold = 0.05 * Ts + 1e-6;
    if (this.free == null || this.free < t0 - 0.25 || this.free > t1 + 10) { this.free = t0; this.cur = null; }
    const chans = s.mode === 'DUAL' ? [0, 1] : s.mode === 'CH2' ? [1] : s.mode === 'ADD' ? ['add'] : [0];
    const draw = (ts, a, b, w) => { for (const c of chans) emit(this.sweep(c, ts, a, b, tE, w)); };
    // 扫描很快：这一帧里有成百上千次扫描，随机抽 K 次画出（统计上与真实叠加一致）
    const nEst = (t1 - t0) / (Ts + hold);
    if (nEst > K_MAX) {
      let hit = 0;
      for (let j = 0; j < K_MAX; j++) {
        const tj = t0 + ((j + Math.random()) / K_MAX) * (t1 - t0);
        const tr = this.nextTrigger(tj);
        const ts = tr ?? (s.trig.mode === 'AUTO' ? tj : null);
        if (tr != null) hit++;
        if (ts != null) draw(ts, ts, ts + Ts, Math.min(1, 3 / K_MAX) * Math.min(4, nEst / K_MAX) ** 0.25);
      }
      this._lastTrig = hit > 0;
      this.free = t1; this.cur = null;
      return;
    }
    let guard = 0;
    while (guard++ < 2 * K_MAX + 4) {
      if (this.cur == null) {
        const ts = this.startAfter(this.free);
        this._lastTrig = ts != null && ts !== this.free ? true : this.nextTrigger(this.free) != null;
        if (ts == null) { this.free = Math.max(this.free, t1 - 1e-9); break; }
        if (ts >= t1) break; // 下一帧再开始
        this.cur = ts;
      }
      const ts = this.cur, a = Math.max(ts, t0), b = Math.min(ts + Ts, t1);
      if (b > a) draw(ts, a, b, 1);
      if (ts + Ts > t1) break; // 这次扫描跨到下一帧
      this.cur = null; this.free = ts + Ts + hold;
      if (this.free >= t1) break;
    }
  }
  /** 一次扫描中 beam 时间 [a,b] 的一段轨迹 */
  sweep(c, ts, a, b, tE, w) {
    const s = this.s, n = Math.max(2, Math.ceil((SWEEP_N * (b - a)) / (10 * tE)));
    const pts = new Float32Array(2 * (n + 1));
    const mag = s.mag ? 10 : 1;
    for (let i = 0; i <= n; i++) {
      const t = a + ((b - a) * i) / n;
      const x0 = (t - ts) / tE - 5;
      pts[2 * i] = x0 * mag + s.xpos;
      pts[2 * i + 1] = c === 'add' ? this.y(0, t) + this.y(1, t) : this.y(c, t);
    }
    return { pts, ref: (10 * mag) / SWEEP_N, w };
  }
  frameXY(t0, t1, emit) {
    const s = this.s, sig = this.sig;
    const per = sig.groups.length ? Math.min(...sig.groups.map((g) => g.T)) : t1 - t0;
    let h = Math.min(per / 160, (t1 - t0) / 200);
    const nMax = 7000;
    const a = Math.max(t0, t1 - nMax * h), n = Math.max(2, Math.ceil((t1 - a) / h));
    h = (t1 - a) / n;
    const pts = new Float32Array(2 * (n + 1));
    let len = 0;
    for (let i = 0; i <= n; i++) {
      const t = a + i * h;
      pts[2 * i] = this.y(0, t) - s.ch[0].pos + s.xpos;
      pts[2 * i + 1] = this.y(1, t);
      if (i) len += Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
    }
    this._lastTrig = true;
    emit({ pts, ref: Math.max(1e-3, (0.5 * len) / n), w: Math.min(3, (t1 - t0) / (t1 - a)) ** 0.5 });
  }
}
