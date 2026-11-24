// 画质自适应：根据每帧物理计算与作图耗时、三维渲染帧间隔，自动调节观察窗分辨率和三维像素比。
// 用户也可以固定为 高 / 中 / 低。
const LEVELS = {
  high: { name: '高', viewScale: 1, viewMaxPx: 2.4e6, pr: 2 },
  mid: { name: '中', viewScale: 0.75, viewMaxPx: 1.1e6, pr: 1.25 },
  low: { name: '低', viewScale: 0.5, viewMaxPx: 0.45e6, pr: 1 },
};
const ORDER = ['low', 'mid', 'high'];

export class Quality {
  constructor(app) {
    this.app = app;
    let m = 'auto';
    try { m = localStorage.getItem('quality') || 'auto'; } catch { /* 忽略 */ }
    this.mode = LEVELS[m] || m === 'auto' ? m : 'auto';
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    // 自动模式的起点：手机从“中”开始，电脑从“高”开始
    this.level = this.mode === 'auto' ? (coarse ? 'mid' : 'high') : this.mode;
    this.coarse = coarse;
    this.ema = 0; this.n = 0; this.tLow = 0; this.tHigh = 0; this.last = performance.now();
    this.apply(false);
  }
  get cfg() { return LEVELS[this.level]; }
  get viewScale() { return this.cfg.viewScale; }
  get viewMaxPx() { return this.cfg.viewMaxPx; }

  setMode(m) {
    this.mode = m;
    try { localStorage.setItem('quality', m); } catch { /* 忽略 */ }
    if (m !== 'auto') this.level = m;
    this.apply();
  }

  apply(refit = true) {
    const st = this.app.stage;
    if (st) {
      const cap = Math.min(this.cfg.pr, this.coarse ? 1.5 : 2);
      const pr = Math.min(window.devicePixelRatio || 1, cap);
      if (Math.abs(st.renderer.getPixelRatio() - pr) > 0.01) { st.renderer.setPixelRatio(pr); st.resize(); }
    }
    if (refit) for (const v of this.app.views.values()) v.fit();
    this.app.onQuality && this.app.onQuality(this);
  }

  /** 每次 update 的耗时（ms） */
  sample(ms) {
    const now = performance.now(), dt = Math.min(0.5, (now - this.last) / 1000);
    this.last = now;
    this.ema = this.n++ < 5 ? ms : this.ema * 0.85 + ms * 0.15;
    if (this.mode !== 'auto' || this.app.running) return; // 一键运行时不改画质，避免结果受影响
    const i = ORDER.indexOf(this.level);
    if (this.ema > 34) { this.tLow += dt; this.tHigh = 0; } else if (this.ema < 9) { this.tHigh += dt; this.tLow = 0; } else { this.tLow = 0; this.tHigh = 0; }
    if (this.tLow > 0.8 && i > 0) { this.level = ORDER[i - 1]; this.reset(); this.apply(); }
    else if (this.tHigh > 5 && i < ORDER.length - 1) { this.level = ORDER[i + 1]; this.reset(); this.apply(); }
  }
  reset() { this.tLow = this.tHigh = 0; this.n = 0; }

  label() { return this.mode === 'auto' ? `自动（当前${this.cfg.name}）` : this.cfg.name; }
}
