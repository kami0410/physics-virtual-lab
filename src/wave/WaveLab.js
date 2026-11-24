// 衍射工作台：选择衍射屏（圆孔、圆屏、单缝、双缝、光栅、矩孔、直边），改变波长、光源距离和观察距离，
// 用标量衍射数值计算（physics/wavefield.js）实时得到观察屏上的光强分布，连续看到从菲涅耳衍射到夫琅禾费衍射的过渡。
import * as W from '../physics/wavefield.js';
import { GW } from '../physics/gpufft.js';
import { cmf, xyzToLinear, encode, wavelengthToRGB } from '../physics/color.js';
import { encodeObj, decodeObj, sceneParam } from '../bench/share.js';

const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (v, d = 3) => (Math.abs(v) >= 1000 ? v.toFixed(0) : (+v).toPrecision(d));
const WHITE = [430, 460, 490, 520, 550, 580, 610, 640, 670];
const sinc = (x) => (Math.abs(x) < 1e-9 ? 1 : Math.sin(x) / x);
const F_COL = 250; // R = 0（平行光）时，扩展光源放在焦距 250 mm 的准直透镜焦面上

// 衍射屏
const APS = {
  circle: { label: '圆孔', p: { a: 2 }, extent: (p) => p.a, feat: (p) => p.a, half: (p) => p.a / 2, fn: (p) => (x, y) => (x * x + y * y <= (p.a / 2) ** 2 ? 1 : 0), note: '圆孔直径 a' },
  disk: { label: '圆屏（泊松亮斑）', p: { a: 2 }, extent: (p) => p.a * 3, feat: (p) => p.a, half: (p) => p.a / 2, fn: (p) => (x, y) => (x * x + y * y <= (p.a / 2) ** 2 ? 0 : 1), opaque: true, note: '不透明圆屏直径 a；屏外是无限大的平面波，计算时用比圆屏大得多的照明区代替' },
  slit: { label: '单缝', p: { a: 0.2 }, extent: (p) => p.a, feat: (p) => p.a, half: (p) => p.a / 2, fn: (p) => (x) => (Math.abs(x) <= p.a / 2 ? 1 : 0), oneD: true, note: '缝宽 a（缝沿竖直方向，长度远大于宽度）' },
  double: { label: '双缝', p: { a: 0.08, d: 0.4 }, extent: (p) => p.d + p.a, feat: (p) => p.a, half: (p) => (p.d + p.a) / 2, fn: (p) => (x) => (Math.abs(Math.abs(x) - p.d / 2) <= p.a / 2 ? 1 : 0), oneD: true, note: '缝宽 a，缝间距 d' },
  grating: { label: '多缝光栅', p: { a: 0.05, d: 0.2, n: 6 }, extent: (p) => p.n * p.d, feat: (p) => p.a, half: (p) => (p.n * p.d) / 2, fn: (p) => (x) => { const u = x / p.d + p.n / 2; if (u < 0 || u > p.n) return 0; const fr = u - Math.floor(u); return Math.abs(fr - 0.5) * p.d <= p.a / 2 ? 1 : 0; }, oneD: true, note: '缝宽 a，光栅常数 d，缝数 N' },
  rect: { label: '矩孔', p: { a: 1, b: 2 }, extent: (p) => Math.max(p.a, p.b), feat: (p) => Math.min(p.a, p.b), half: (p) => p.a / 2, fn: (p) => (x, y) => (Math.abs(x) <= p.a / 2 && Math.abs(y) <= p.b / 2 ? 1 : 0), note: '宽 a（水平）× 高 b' },
  edge: { label: '直边（半无限大屏）', p: {}, extent: () => 0, feat: () => 0.5, half: () => 0, edge: true, fn: () => (x) => (x >= 0 ? 1 : 0), oneD: true, note: '刀口沿竖直方向放在 x = 0 处，左侧被挡住' },
};
const PRESETS = [
  { t: '菲涅耳圆孔衍射', ap: 'circle', p: { a: 2 }, lam: 632.8, z: 790, R: 0, txt: '圆孔对观察点露出的半波带数 N=ρ²/λ·(1/z+1/R)。N 为奇数时中心亮，偶数时中心暗。缓慢改变 z，看中心亮暗交替。' },
  { t: '泊松亮斑', ap: 'disk', p: { a: 2 }, lam: 632.8, z: 400, R: 0, txt: '不透明圆屏的几何阴影中心出现亮点，强度与没有圆屏时相同——菲涅耳衍射理论的著名验证。' },
  { t: '单缝：近场到远场', ap: 'slit', p: { a: 0.3 }, lam: 632.8, z: 30, R: 0, txt: '从 z 很小（几何投影 + 边缘条纹）逐渐增大到菲涅耳数 N≪1，图样过渡为 sinc² 形的夫琅禾费衍射，中央亮纹宽 2λz/a。' },
  { t: '杨氏双缝', ap: 'double', p: { a: 0.08, d: 0.4 }, lam: 632.8, z: 1000, R: 0, txt: '双缝干涉条纹间距 λz/d，被单缝衍射 sinc² 包络调制。d/a 为整数时出现缺级。' },
  { t: '多缝光栅', ap: 'grating', p: { a: 0.05, d: 0.2, n: 6 }, lam: 632.8, z: 2000, R: 0, txt: 'N 缝干涉：相邻主极大之间有 N−1 个极小、N−2 个次极大；缝数越多主极大越细。' },
  { t: '白光单缝', ap: 'slit', p: { a: 0.15 }, lam: 550, white: true, z: 1200, R: 0, txt: '白光下各波长的条纹间距不同，中央亮纹为白色，两侧条纹带彩色（内紫外红）。' },
  { t: '直边衍射', ap: 'edge', p: {}, lam: 632.8, z: 500, R: 0, txt: '几何阴影边界处光强为入射光的 1/4，亮区一侧出现逐渐变密的条纹，最大值约 1.37 倍——菲涅耳积分（考纽螺线）的结果。' },
  { t: '矩孔衍射', ap: 'rect', p: { a: 0.5, b: 1 }, lam: 532, z: 3000, R: 0, txt: '远场图样沿两个方向分别是 sinc²，较窄的一边对应较宽的衍射图样。' },
  { t: '光源宽度与条纹可见度', ap: 'double', p: { a: 0.08, d: 0.4 }, lam: 632.8, z: 1000, R: 500, srcW: 0.4, txt: '光源不是点而是宽 w 的狭缝时，各点产生的条纹彼此错开，叠加后对比度下降：双缝处的横向相干宽度为 λR/w，可见度 V = |sinc(πwd/λR)|。把 w 加大到 λR/d ≈ 0.79 mm，条纹完全消失；再加大又会出现对比度反转的弱条纹。' },
  { t: '谱宽与相干长度', ap: 'double', p: { a: 0.05, d: 0.5 }, lam: 589.3, dl: 60, z: 1500, R: 0, txt: '光源有一定谱宽 Δλ 时，各波长的条纹间距不同，离中央越远错开越多：能看清的条纹级次约 λ/Δλ，对应的光程差就是相干长度 λ²/Δλ。把谱宽改成 0（激光）或 0.6 nm（钠灯 D 线量级）比较。' },
];

export class WaveLab {
  constructor(root, { onExit }) {
    this.root = root; this.onExit = onExit;
    this.s = { ap: 'circle', p: { ...APS.circle.p }, lam: 632.8, white: false, z: 790, R: 0, N: 512, gamma: 0.6, expo: 0, log: false, srcW: 0, dl: 0 };
    this.build();
    const sp = sceneParam();
    if (sp) this.loadShared(sp); else this.load(0);
    this.keyH = () => {};
  }

  build() {
    this.root.innerHTML = '';
    const page = h('div', 'bench wave');
    page.innerHTML = `
      <header class="topbar">
        <button class="btn" data-a="back" title="返回实验目录"><svg class="i" viewBox="0 0 16 16"><path d="M10 3 5 8l5 5"/></svg>目录</button>
        <div class="title"><b>衍射工作台</b><small>标量衍射数值计算 · 角谱法 / 菲涅耳变换</small></div>
        <span class="spacer"></span>
        <div class="tb-group"><select data-a="preset"><option value="">典型现象…</option>${PRESETS.map((p, i) => `<option value="${i}">${p.t}</option>`).join('')}</select>
          <span class="tb-sep"></span>
          <button class="btn small" data-a="png" title="保存观察屏图样">存图</button>
          <button class="btn small" data-a="share" title="生成包含全部参数的网址，发给别人打开就是同一个衍射装置">分享</button></div>
      </header>
      <div class="bench-main wave-main">
        <aside class="bpanel wctl"></aside>
        <section class="wstage">
          <div class="wscreen"><canvas class="wcv" width="512" height="512"></canvas><div class="wscale mono"></div></div>
          <div class="wprof"><canvas class="wpc" width="900" height="200"></canvas></div>
        </section>
        <aside class="bpanel binsp winfo"></aside>
      </div>`;
    this.root.append(page);
    const q = (s) => page.querySelector(s);
    this.page = page; this.cv = q('.wcv'); this.pc = q('.wpc'); this.ctl = q('.wctl'); this.info = q('.winfo'); this.scaleEl = q('.wscale');
    q('[data-a=back]').onclick = () => this.onExit && this.onExit();
    q('[data-a=preset]').onchange = (e) => { if (e.target.value !== '') this.load(+e.target.value); e.target.value = ''; };
    q('[data-a=share]').onclick = () => this.share();
    q('[data-a=png]').onclick = () => { const a = document.createElement('a'); a.download = '衍射图样.png'; a.href = this.cv.toDataURL('image/png'); a.click(); };
  }

  // ------------------------------------------------------------ 分享
  /** 可分享的状态（不含显示网格大小以外的临时量） */
  shareState() { const { ap, p, lam, white, z, R, N, gamma, expo, srcW, dl } = this.s; return { v: 1, s: { ap, p, lam, white, z, R, N, gamma, expo, srcW, dl }, t: this.presetTxt || '' }; }
  shareCode() { return encodeObj(this.shareState()); }
  async share() {
    const url = `${location.href.split('#')[0]}#/wave?s=${await this.shareCode()}`;
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch { /* 无剪贴板权限 */ }
    if (ok) this.flash(`分享网址已复制（${url.length} 个字符）`); else window.prompt('复制下面的网址发给别人：', url);
  }
  async loadShared(code) {
    const d = await decodeObj(code);
    if (this.disposed) return;
    const st = d && d.s;
    if (!st || !APS[st.ap]) { this.load(0); this.flash('分享链接无法解析，已载入默认装置', 'warn'); return; }
    const num = (v, lo, hi, def) => (isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : def);
    Object.assign(this.s, {
      ap: st.ap, p: { ...APS[st.ap].p, ...(st.p || {}) }, lam: num(st.lam, 380, 780, 632.8), white: !!st.white, z: num(st.z, 0.5, 1e5, 500), R: num(st.R, 0, 1e6, 0),
      N: [256, 512, 1024].includes(+st.N) ? +st.N : 512, gamma: num(st.gamma, 0.1, 1, 0.6), expo: num(st.expo, -3, 3, 0), srcW: num(st.srcW, 0, 50, 0), dl: num(st.dl, 0, 200, 0),
    });
    this.presetTxt = typeof d.t === 'string' ? d.t : '';
    this.renderCtl(); this.compute();
    try { history.replaceState(null, '', location.href.replace(/#.*$/, '#/wave')); } catch { /* file:// 下个别浏览器不允许 */ }
    this.flash('已载入分享的衍射装置');
  }
  flash(msg, kind = 'ok') {
    let box = this.page.querySelector('.toasts');
    if (!box) { box = h('div', 'toasts'); this.page.append(box); }
    const t = h('div', 'toast ' + kind); t.textContent = msg; box.append(t);
    setTimeout(() => t.remove(), 3600);
  }

  load(i) {
    const P = PRESETS[i];
    Object.assign(this.s, { ap: P.ap, p: { ...APS[P.ap].p, ...P.p }, lam: P.lam, white: !!P.white, z: P.z, R: P.R, N: P.white ? 256 : 512, srcW: P.srcW || 0, dl: P.dl || 0 });
    this.presetTxt = P.txt;
    this.renderCtl();
    this.compute();
  }

  renderCtl() {
    const s = this.s, A = APS[s.ap], box = this.ctl;
    box.innerHTML = '';
    const sec = (t) => box.append(h('div', 'bp-h', t));
    const row = (label, inp, unit = '') => { const r = h('label', 'bi-row', `<span>${label}</span>`); r.append(inp, h('em', null, unit)); box.append(r); return inp; };
    const num = (v, step, on, min = 0) => { const i = h('input'); i.type = 'number'; i.step = step; i.min = min; i.value = v; i.onchange = () => { const x = parseFloat(i.value); if (isFinite(x) && x >= min) on(x); }; return i; };
    sec('衍射屏');
    const sel = h('select'); for (const [k, a] of Object.entries(APS)) { const o = h('option', null, a.label); o.value = k; if (k === s.ap) o.selected = true; sel.append(o); }
    sel.onchange = () => { s.ap = sel.value; s.p = { ...APS[s.ap].p }; this.presetTxt = APS[s.ap].note; this.renderCtl(); this.compute(); };
    row('类型', sel);
    const names = { a: s.ap === 'circle' || s.ap === 'disk' ? '直径 a' : s.ap === 'rect' ? '宽 a' : '缝宽 a', b: '高 b', d: '缝间距 d', n: '缝数 N' };
    for (const k of Object.keys(A.p)) row(names[k], num(s.p[k], k === 'n' ? 1 : 0.01, (v) => { s.p[k] = k === 'n' ? Math.max(2, Math.round(v)) : v; this.compute(); }, k === 'n' ? 2 : 0.001), k === 'n' ? '' : 'mm');
    box.append(h('div', 'bi-sub', A.note));
    sec('光源');
    const wl = h('input'); wl.type = 'checkbox'; wl.checked = s.white; wl.onchange = () => { s.white = wl.checked; s.N = s.white ? 256 : 512; this.renderCtl(); this.compute(); };
    const r0 = h('label', 'bi-row bi-chk', '<span>白光（9 个波长叠加）</span>'); r0.append(wl); box.append(r0);
    if (!s.white) row('波长 λ', num(s.lam, 0.1, (v) => { s.lam = Math.min(780, Math.max(380, v)); this.compute(); }, 380), 'nm');
    row('点光源距离 R', num(s.R, 10, (v) => { s.R = v; this.compute(); }), 'mm').title = '0 表示平行光照明；有限值为点光源发出的球面波';
    box.append(h('div', 'bi-sub', 'R = 0 为平行光（激光扩束准直后）'));
    row('光源宽度 w', num(s.srcW, 0.05, (v) => { s.srcW = v; this.compute(); }), 'mm').title = '0 为理想点光源。缝状衍射屏配缝状光源（与缝平行），其余配圆形光源（直径 w）';
    box.append(h('div', 'bi-sub', `扩展光源各点互不相干，光强相加。${s.R > 0 ? '' : `R = 0 时光源放在焦距 ${F_COL} mm 的准直透镜焦面上。`}`));
    if (!s.white) row('谱宽 Δλ', num(s.dl, 0.5, (v) => { s.dl = Math.min(200, v); this.compute(); }), 'nm').title = '光谱的半高全宽，按高斯线型取 7 个波长叠加；0 为单色光';
    sec('观察屏');
    const zr = h('input'); zr.type = 'range'; zr.min = 0; zr.max = 1000; zr.step = 1;
    const toR = (z) => (Math.log10(z) / 4) * 1000, fromR = (v) => Math.pow(10, (v / 1000) * 4);
    zr.value = toR(s.z);
    const zn = num(+s.z.toFixed(1), 1, (v) => { s.z = Math.max(0.5, v); zr.value = toR(s.z); this.compute(); }, 0.5);
    zr.oninput = () => { s.z = +fromR(+zr.value).toPrecision(3); zn.value = s.z; this.compute(true); };
    zr.onchange = () => this.compute();
    row('距离 z', zn, 'mm');
    const rr = h('div', 'wrange'); rr.append(zr); box.append(rr);
    box.append(h('div', 'bi-sub', '拖动滑块：1 mm ~ 10 m（对数刻度）'));
    sec('显示');
    const gm = h('select'); for (const [v, t] of [[1, '线性（光强）'], [0.6, 'γ=0.6（接近肉眼）'], [0.3, 'γ=0.3（看清弱条纹）']]) { const o = h('option', null, t); o.value = v; if (+v === s.gamma) o.selected = true; gm.append(o); }
    gm.onchange = () => { s.gamma = +gm.value; this.render(); };
    row('亮度曲线', gm);
    const ex = h('input'); ex.type = 'range'; ex.min = -3; ex.max = 3; ex.step = 0.1; ex.value = s.expo; ex.oninput = () => { s.expo = +ex.value; this.render(); };
    const er = h('label', 'bi-row', '<span>曝光</span>'); er.append(ex, h('em', null, 'EV')); box.append(er);
    const ng = h('select'); for (const v of [256, 512, 1024]) { const o = h('option', null, `${v}×${v}`); o.value = v; if (v === s.N) o.selected = true; ng.append(o); }
    ng.onchange = () => { s.N = +ng.value; this.compute(); };
    row('计算网格', ng);
  }

  /**
   * 选取计算网格。图样大小 W 取“几何投影 + 菲涅耳展宽”与“远场衍射角”中较大者。
   * 角谱法要求 z ≤ L²/(Nλ)（传递函数可被采样），故 L 取 max(W, √(Nλz))，只要孔径仍有足够像素就用角谱法；
   * 否则用单次 FFT 菲涅耳变换（要求 z ≥ L²/(Nλ)），输入窗口 L = λzN/W，使输出窗口恰为 W。
   */
  grid(lam) {
    const s = this.s, A = APS[s.ap], N = s.N;
    const zEff = s.R > 0 ? (s.z * s.R) / (s.z + s.R) : s.z; // 球面波照明的等效距离（菲涅耳近似）
    const spread = Math.sqrt(lam * zEff);
    if (A.edge) return { L: Math.max(2, 24 * spread, Math.sqrt(N * lam * s.z) * 1.05), method: 'asm', Wp: 16 * spread };
    const E = A.extent(s.p), a = A.feat(s.p), mag = 1 + (s.R > 0 ? s.z / s.R : 0);
    const Wp = Math.max(1.4 * E * mag, E * mag + 8 * spread, (10 * lam * s.z) / a) + this.srcBlur();
    let L = Math.max(Wp, Math.sqrt(N * lam * s.z) * 1.02);
    if (A.opaque) L = Math.max(L, 5 * E);
    if (L / N <= a / 5) return { L, method: 'asm', Wp };
    return { L: Math.max(1.2 * E, (lam * s.z * N) / Wp), method: 'fresnel', Wp };
  }

  field(lam, L, withPhase = true) {
    const s = this.s, A = APS[s.ap], N = s.N;
    const F = W.begin(N, L, lam);
    if (A.edge) {
      // 直边：用宽度为窗口 0.42 倍的“半无限”透光区，两侧加缓变窗口，减小周期边界的影响
      const Lw = L * 0.42, tap = L * 0.06;
      W.maskX(F, (x) => (x < 0 ? 0 : x > Lw ? 0 : x > Lw - tap ? 0.5 + 0.5 * Math.cos((Math.PI * (x - Lw + tap)) / tap) : 1), 3);
    } else if (A.opaque) {
      // 圆屏：外面是平面波；照明区边缘用余弦缓变（模拟有限大的照明光斑），避免截断引起的人为条纹
      const r0 = L * 0.42, tap = L * 0.07, Rd = s.p.a / 2;
      W.maskRadial(F, (r) => (r <= Rd ? 0 : r < r0 - tap ? 1 : r > r0 ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * (r - r0 + tap)) / tap)), Rd, 3);
    } else if (A.oneD) W.maskX(F, A.fn(s.p), 3);
    else if (s.ap === 'rect') W.maskSep(F, (x) => (Math.abs(x) <= s.p.a / 2 ? 1 : 0), (y) => (Math.abs(y) <= s.p.b / 2 ? 1 : 0), 3);
    else if (s.ap === 'circle') W.maskRadial(F, (r) => (r <= s.p.a / 2 ? 1 : 0), s.p.a / 2, 3);
    else W.mask(F, A.fn(s.p), 3);
    if (withPhase && s.R > 0) W.spherical(F, s.R);
    return F;
  }

  compute(fast = false) {
    clearTimeout(this.tm);
    this.tm = setTimeout(() => this._compute(fast), fast ? 0 : 10);
  }
  _compute(fast) {
    const s = this.s, t0 = performance.now();
    const spec = s.white ? WHITE.map((nm) => ({ nm, w: 1 / WHITE.length })) : W.spectrumSamples(s.lam, s.dl, 7);
    const lams = spec.map((o) => o.nm);
    const nSave = s.N, gpu = GW.ok(s.N);
    if (fast && s.N > (gpu ? 512 : 256)) s.N = gpu ? 512 : 256; // 拖动滑块时先用粗网格
    const lamRef = s.white ? 550 : s.lam;
    const g = this.grid(lamRef * 1e-6);
    const res = [];
    const bw = this.srcBlur(), A = APS[s.ap];
    // GPU：透过率与波长无关，只算一次；各波长的相位、FFT 与光强在显卡上完成
    let mask = gpu ? Float32Array.from(this.field(lamRef * 1e-6, g.L, false).re) : null;
    this.engine = 'CPU';
    for (const { nm, w } of spec) {
      const lam = nm * 1e-6;
      let I = null, size = g.method === 'asm' ? g.L : (lam * s.z * s.N) / g.L;
      if (mask) {
        try { I = GW.run({ mask, N: s.N, L: g.L, lam, R: s.R, z: s.z, method: g.method }); this.engine = 'GPU'; } catch (err) { console.warn('GPU 衍射计算失败，改用 CPU：', err.message); GW.verified = false; mask = null; }
      }
      if (!I) {
        const out = g.method === 'asm' ? W.angularSpectrum(this.field(lam, g.L), s.z) : W.fresnelFar(this.field(lam, g.L), s.z);
        I = W.intensity(out); size = out.size;
      }
      // 扩展光源：与光源在观察屏上的投影像卷积（缝状衍射屏用平行于缝的线光源）
      if (bw > 0) { const px = bw / (size / s.N); I = A.oneD || A.edge ? W.blurLine(I, s.N, px) : W.blurDisk(I, s.N, px / 2); }
      res.push({ nm, w, I, size });
    }
    const size = res[Math.floor(res.length / 2)].size;
    // 显示窗口：只显示图样所在的中央区域（计算窗口往往更大，以满足采样条件）
    this.out = { res, N: s.N, full: size, size: Math.min(size, g.Wp * 1.15), method: g.method, L: g.L, lams };
    s.N = nSave;
    this.ms = performance.now() - t0;
    this.render();
    this.renderInfo();
  }

  render() {
    const o = this.out; if (!o) return;
    const s = this.s, N = o.N, cv = this.cv, g = cv.getContext('2d');
    cv.width = N; cv.height = N;
    const img = g.createImageData(N, N);
    // 显示网格取中间波长的输出网格；其他波长按物理坐标双线性取样（远场网格随波长缩放）
    const X = new Float64Array(N * N), Y = new Float64Array(N * N), Z = new Float64Array(N * N);
    const dxD = o.size / N;
    for (const r of o.res) {
      const c = cmf(r.nm), k = r.size / N, w = r.w; // k：该波长输出网格的像素尺寸；w：光谱权重
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const u = ((j - N / 2) * dxD) / k + N / 2, v = ((i - N / 2) * dxD) / k + N / 2;
        const j0 = Math.floor(u), i0 = Math.floor(v);
        if (j0 < 0 || i0 < 0 || j0 >= N - 1 || i0 >= N - 1) continue;
        const fu = u - j0, fv = v - i0, b = i0 * N + j0;
        const I = (r.I[b] * (1 - fu) + r.I[b + 1] * fu) * (1 - fv) + (r.I[b + N] * (1 - fu) + r.I[b + N + 1] * fu) * fv;
        const q = i * N + j;
        X[q] += I * c[0] * w; Y[q] += I * c[1] * w; Z[q] += I * c[2] * w;
      }
    }
    // XYZ → 线性 sRGB；自动曝光：让各像素最大颜色分量的 99.7 百分位对应满亮度（单色光也能正确显示明暗）
    const RGB = new Float32Array(N * N * 3), mc = [];
    for (let q = 0; q < N * N; q++) {
      if (!(Y[q] > 0)) continue;
      const lin = xyzToLinear([X[q], Y[q], Z[q]]);
      let m = 0;
      for (let c = 0; c < 3; c++) { const v = Math.max(0, lin[c]); RGB[q * 3 + c] = v; m = Math.max(m, v); }
      if (m > 0) mc.push(m);
    }
    mc.sort((a, b) => a - b);
    const ref = (mc[Math.floor(mc.length * 0.997)] || 1) / Math.pow(2, s.expo);
    for (let q = 0; q < N * N; q++) {
      const p = q * 4;
      img.data[p + 3] = 255;
      for (let c = 0; c < 3; c++) img.data[p + c] = 255 * encode(Math.pow(Math.min(1, RGB[q * 3 + c] / ref), s.gamma));
    }
    g.putImageData(img, 0, 0);
    // 比例尺
    const nice = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
    const Ls = nice.find((v) => v / o.size >= 0.18) || 500;
    this.scaleEl.innerHTML = `<i style="width:${((Ls / o.size) * this.cv.clientWidth).toFixed(0)}px"></i>${Ls < 1 ? Ls * 1000 + ' µm' : Ls + ' mm'}　视场 ${fmt(o.size)} mm`;
    this.drawProfile(X, Y, N);
  }

  /** 观察屏中央水平线上的光强（相对于入射光强），并叠加夫琅禾费理论曲线 */
  drawProfile(X, Y, N) {
    const o = this.out, s = this.s, A = APS[s.ap];
    const pc = this.pc, g = pc.getContext('2d'), Wd = pc.width, Hd = pc.height;
    g.fillStyle = '#0d1110'; g.fillRect(0, 0, Wd, Hd);
    // 光强以入射平面波为 1（单色）；白光取各波长平均
    const prof = new Float64Array(N);
    for (const r of o.res) {
      const k = r.size / o.size;
      for (let j = 0; j < N; j++) {
        const u = (j - N / 2) / k + N / 2, j0 = Math.floor(u);
        if (j0 < 0 || j0 >= N - 1) continue;
        const b = (N / 2) * N + j0, fu = u - j0;
        prof[j] += (r.I[b] * (1 - fu) + r.I[b + 1] * fu) * r.w;
      }
    }
    let mx = 0; for (const v of prof) mx = Math.max(mx, v);
    const top = mx > 0 ? mx * 1.08 : 1;
    const pad = 34, x = (j) => pad + ((Wd - pad - 8) * j) / (N - 1), y = (v) => Hd - 18 - ((Hd - 30) * v) / top;
    g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const yy = y((top * k) / 4); g.beginPath(); g.moveTo(pad, yy); g.lineTo(Wd - 8, yy); g.stroke(); }
    g.fillStyle = 'rgba(233,237,230,.55)'; g.font = '11px "IBM Plex Mono", monospace';
    g.fillText(fmt(top, 3), 2, 14); g.fillText('0', 20, Hd - 18);
    g.fillText(`−${fmt(o.size / 2)} mm`, pad, Hd - 4); g.fillText(`+${fmt(o.size / 2)} mm`, Wd - 70, Hd - 4); g.fillText('x', Wd / 2, Hd - 4);
    // 曲线
    const col = s.white ? '#e9ede6' : (() => { const c = wavelengthToRGB(s.lam); return `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`; })();
    g.strokeStyle = col; g.lineWidth = 1.6; g.beginPath();
    for (let j = 0; j < N; j++) (j ? g.lineTo(x(j), y(prof[j])) : g.moveTo(x(j), y(prof[j])));
    g.stroke();
    this.prof = prof;
    // 夫琅禾费理论（单色、N_F < 0.3 时叠加；扩展光源时双缝按可见度 V 修正）
    const lam = s.lam * 1e-6, NF = this.NF(), V = this.visTheory();
    if (!s.white && !(s.dl > 0) && NF < 0.3 && !A.edge && !A.opaque && (s.srcW === 0 || V != null)) {
      const I0 = prof[N / 2];
      const th = (xx) => {
        const fx = xx / (lam * s.z);
        switch (s.ap) {
          case 'circle': { const v = Math.PI * s.p.a * Math.abs(fx); const j1 = besselJ1(v); return v < 1e-9 ? 1 : (2 * j1 / v) ** 2; }
          case 'slit': return sinc(Math.PI * s.p.a * fx) ** 2;
          case 'rect': return sinc(Math.PI * s.p.a * fx) ** 2;
          case 'double': return sinc(Math.PI * s.p.a * fx) ** 2 * (1 + (V ?? 1) * Math.cos(2 * Math.PI * s.p.d * fx)) / 2;
          case 'grating': { const b = Math.PI * s.p.d * fx, n = s.p.n; const m = Math.abs(Math.sin(b)) < 1e-9 ? 1 : (Math.sin(n * b) / (n * Math.sin(b))) ** 2; return sinc(Math.PI * s.p.a * fx) ** 2 * m; }
          default: return 0;
        }
      };
      g.strokeStyle = 'rgba(242,193,78,.9)'; g.setLineDash([4, 3]); g.lineWidth = 1; g.beginPath();
      const t0 = th(0) || 1;
      for (let j = 0; j < N; j++) { const xx = (j - N / 2) * (o.size / N), v = (I0 * th(xx)) / t0; (j ? g.lineTo(x(j), y(v)) : g.moveTo(x(j), y(v))); }
      g.stroke(); g.setLineDash([]);
      g.fillStyle = 'rgba(242,193,78,.9)'; g.fillText('--- 夫琅禾费理论', Wd - 140, 14);
    }
    g.fillStyle = col; g.fillText('— 数值计算 I/I₀', Wd - 290, 14);
  }

  /** 扩展光源在观察屏上的投影宽度（mm） */
  srcBlur() { const s = this.s; return s.srcW > 0 ? (s.srcW * s.z) / (s.R > 0 ? s.R : F_COL) : 0; }
  /** 光源张角（rad）与双缝处的横向相干宽度 */
  srcAngle() { const s = this.s; return s.srcW / (s.R > 0 ? s.R : F_COL); }
  /** 双缝条纹可见度的理论值（缝状光源、单色）：V = sinc(π d θ_s / λ)，可为负（对比度反转） */
  visTheory() {
    const s = this.s;
    if (s.ap !== 'double' || s.white) return null;
    return sinc((Math.PI * s.p.d * this.srcAngle()) / (s.lam * 1e-6));
  }
  /** 从中央水平线的光强测条纹可见度：中央 ±0.6 个条纹间距内的 (max − min)/(max + min) */
  visMeasured() {
    const s = this.s, o = this.out, prof = this.prof;
    if (s.ap !== 'double' || !prof) return null;
    const N = o.N, px = o.size / N, P = (s.lam * 1e-6 * s.z) / s.p.d; // 远场杨氏条纹间距 λz/d（与 R 无关）
    const k = Math.max(2, Math.round((0.6 * P) / px)); // ±0.6 个条纹：含中央极大和两侧极小，单缝包络的影响小
    let mx = 0, mn = Infinity;
    for (let j = N / 2 - k; j <= N / 2 + k; j++) { if (j < 0 || j >= N) continue; mx = Math.max(mx, prof[j]); mn = Math.min(mn, prof[j]); }
    return mx > 0 ? (mx - mn) / (mx + mn) : null;
  }

  NF() {
    const s = this.s, A = APS[s.ap], lam = (s.white ? 550 : s.lam) * 1e-6;
    const rho = A.half(s.p) || A.feat(s.p) / 2;
    return ((rho * rho) / lam) * (1 / s.z + (s.R > 0 ? 1 / s.R : 0));
  }

  renderInfo() {
    const s = this.s, o = this.out, A = APS[s.ap], NF = this.NF();
    const regime = NF > 3 ? '菲涅耳衍射（近场，接近几何投影）' : NF > 0.3 ? '菲涅耳衍射' : NF > 0.05 ? '向夫琅禾费过渡' : '夫琅禾费衍射（远场）';
    const lam = (s.white ? 550 : s.lam) * 1e-6;
    let extra = '';
    if (s.ap === 'circle' || s.ap === 'disk') {
      const Ic = s.ap === 'circle' ? 4 * Math.sin((Math.PI * NF) / 2) ** 2 : 1;
      const N = o.N, mid = o.res[Math.floor(o.res.length / 2)].I[(N / 2) * N + N / 2];
      extra += `<tr><td>露出的半波带数</td><td>${NF.toFixed(2)}</td></tr><tr><td>中心光强（计算）</td><td>${mid.toFixed(3)} I₀</td></tr><tr><td>中心光强（理论）</td><td>${Ic.toFixed(3)} I₀</td></tr>`;
      if (s.ap === 'circle' && NF < 0.3) extra += `<tr><td>艾里斑半径 1.22λz/a</td><td>${fmt((1.22 * lam * s.z) / s.p.a)} mm</td></tr>`;
    }
    if (s.ap === 'slit' || s.ap === 'rect') extra += `<tr><td>中央亮纹半宽 λz/a</td><td>${fmt((lam * s.z) / s.p.a)} mm</td></tr>`;
    if (s.ap === 'double' || s.ap === 'grating') extra += `<tr><td>条纹间距 λz/d</td><td>${fmt((lam * s.z) / s.p.d)} mm</td></tr><tr><td>缺级</td><td>${Number.isInteger(+(s.p.d / s.p.a).toFixed(6)) ? `${(s.p.d / s.p.a).toFixed(0)} 的整数倍级` : '无'}</td></tr>`;
    if (s.srcW > 0) {
      const th = this.srcAngle(), lc = (lam / th);
      extra += `<tr><td>光源张角 θ<sub>s</sub></td><td>${fmt(th * 1000)} mrad</td></tr><tr><td>横向相干宽度 λ/θ<sub>s</sub></td><td>${fmt(lc)} mm</td></tr>`;
    }
    if (s.dl > 0 && !s.white) extra += `<tr><td>相干长度 λ²/Δλ</td><td>${fmt((s.lam * s.lam) / s.dl / 1e6)} mm</td></tr><tr><td>可见条纹级次 ≈ λ/Δλ</td><td>${fmt(s.lam / s.dl)}</td></tr>`;
    const Vt = this.visTheory(), Vm = this.visMeasured();
    if (Vt != null && (s.srcW > 0 || s.dl > 0)) extra += `<tr><td>中央条纹可见度（计算）</td><td>${Vm == null ? '—' : Vm.toFixed(3)}</td></tr>${s.dl > 0 ? '' : `<tr><td>可见度理论 |sinc(πdθ<sub>s</sub>/λ)|</td><td>${Math.abs(Vt).toFixed(3)}${Vt < 0 ? '（反转）' : ''}</td></tr>`}`;
    this.info.innerHTML = `
      <div class="bi-h">${A.label}</div>
      <p class="bi-empty" style="color:var(--ink-2)">${this.presetTxt || A.note}</p>
      <table class="bi-tab">
        <tr><td>菲涅耳数 N<sub>F</sub></td><td>${NF.toPrecision(3)}</td></tr>
        <tr><td>衍射区</td><td style="font-family:var(--sans)">${regime}</td></tr>
        ${extra}
        <tr><td>算法</td><td style="font-family:var(--sans)">${o.method === 'asm' ? '带限角谱法' : '单次 FFT 菲涅耳变换'}</td></tr>
        <tr><td>计算网格</td><td>${o.N}² · ${fmt(o.L)} mm</td></tr>
        <tr><td>显示范围</td><td>${fmt(o.size)} mm</td></tr>
        <tr><td>计算耗时</td><td>${this.ms.toFixed(0)} ms · ${this.engine === 'GPU' ? 'GPU' : 'CPU'}</td></tr>
      </table>
      <div class="bi-h2">说明</div>
      <p class="bi-empty">菲涅耳数 N<sub>F</sub> = ρ²/λ·(1/z + 1/R)，ρ 为孔径半宽。N<sub>F</sub> ≫ 1 时屏上基本是孔的几何投影，N<sub>F</sub> ≪ 1 时为夫琅禾费衍射。曲线是屏幕中央水平线上的光强，以入射光强 I₀ 为单位；N<sub>F</sub> &lt; 0.3 时虚线给出夫琅禾费公式作对照。</p>
      <p class="bi-empty">计算方法：网格上的复振幅经 FFT 做角谱传播（近场），或乘二次相位后做一次 FFT（远场）。不做傍轴近似之外的简化，因此近场的边缘条纹、泊松亮斑都能直接算出。${this.engine === 'GPU' ? `FFT 在显卡上用单精度浮点计算（${esc(GW.renderer)}），启动时已与 CPU 双精度结果对比自检。` : ''}</p>`;
  }

  dispose() { this.disposed = true; clearTimeout(this.tm); this.root.innerHTML = ''; }
}

function besselJ1(x) {
  // Abramowitz & Stegun 9.4.4 / 9.4.6 多项式近似
  const ax = Math.abs(x);
  if (ax < 8) {
    const y = x * x;
    const a = x * (72362614232.0 + y * (-7895059235.0 + y * (242396853.1 + y * (-2972611.439 + y * (15704.4826 + y * -30.16036606)))));
    const b = 144725228442.0 + y * (2300535178.0 + y * (18583304.74 + y * (99447.43394 + y * (376.9991397 + y))));
    return a / b;
  }
  const z = 8 / ax, y = z * z, xx = ax - 2.356194491;
  const a = 1 + y * (0.183105e-2 + y * (-0.3516396496e-4 + y * (0.2457520174e-5 + y * -0.240337019e-6)));
  const b = 0.04687499995 + y * (-0.2002690873e-3 + y * (0.8449199096e-5 + y * (-0.88228987e-6 + y * 0.105787412e-6)));
  const r = Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * a - z * Math.sin(xx) * b);
  return x < 0 ? -r : r;
}
