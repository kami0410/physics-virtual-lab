// 光路设计台：在光学平台上自由摆放光源、透镜、反射镜、棱镜、光栅、光屏，实时追迹光线。
// 物理计算见 physics/rays2d.js（二维非顺序追迹）与 physics/lensTrace.js（透镜的傍轴参数与赛德尔像差）。
import { traceScene, irradiance, inside, hitGeom, v2 } from '../physics/rays2d.js';
import { TYPES, GROUPS, makeElement, compile, WHITE } from './elements.js';
import { PRESETS } from './presets.js';
import { wavelengthToRGB } from '../physics/color.js';
import { index, abbe, GLASS_NAMES, glassData, COMMON, ALIASES, typeCN } from '../physics/glassdb.js';
import { CATALOGUE } from '../physics/glasscat.js';
import { paraxial, seidel, LENSES } from '../physics/lensTrace.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const STORE = 'bench-scene-v1';
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const fmt = (v, d = 2) => (v == null || !isFinite(v) ? '—' : (+v).toFixed(d));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// 元件图标（线描，24×24）
const ICON = {
  laser: '<rect x="3" y="9" width="11" height="6" rx="1"/><path d="M14 12h7"/><path d="M18 10l3 2-3 2"/>',
  beam: '<path d="M4 6v12"/><path d="M4 8h16M4 12h16M4 16h16"/>',
  point: '<circle cx="6" cy="12" r="2"/><path d="M8 12h12M8 11l11-6M8 13l11 6"/>',
  lens: '<path d="M12 3c3 3 3 15 0 18c-3-3-3-15 0-18z"/>',
  achromat: '<path d="M10 3c2.5 3 2.5 15 0 18c-2.5-3-2.5-15 0-18z"/><path d="M10 3h4v18h-4"/>',
  ideal: '<path d="M12 3v18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3"/>',
  camera: '<path d="M6 5c2 2 2 12 0 14M10 4c2 3 2 13 0 16M14 6v12M18 5c-2 2-2 12 0 14"/>',
  mirror: '<path d="M12 3v18"/><path d="M12 5l4-2M12 9l4-2M12 13l4-2M12 17l4-2"/>',
  sphMirror: '<path d="M10 3c5 4 5 14 0 18"/><path d="M13 6l3-1M14 10l3-1M14 14l3-1M13 18l3-1"/>',
  paraMirror: '<path d="M9 3c7 3 7 15 0 18"/><circle cx="5" cy="12" r="1"/>',
  idealMirror: '<path d="M12 3v18"/><path d="M15 6l-3-3-3 3M15 18l-3 3-3-3"/>',
  splitter: '<path d="M6 18L18 6"/><path d="M3 12h18M12 3v9"/>',
  prism: '<path d="M12 4l8 15H4z"/>',
  block: '<rect x="8" y="3" width="8" height="18"/>',
  semicircle: '<path d="M8 3v18a9 9 0 0 0 0-18z"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  tank: '<rect x="3" y="6" width="18" height="12"/><path d="M3 10c3-1.5 6 1.5 9 0s6 1.5 9 0"/>',
  grating: '<path d="M12 3v18"/><path d="M10 5h4M10 8h4M10 11h4M10 14h4M10 17h4"/>',
  blocker: '<path d="M12 3v18" stroke-width="4"/>',
  aperture: '<path d="M12 3v6M12 15v6" stroke-width="3"/>',
  detector: '<rect x="10" y="3" width="4" height="18"/><path d="M6 8h4M6 12h4M6 16h4"/>',
};
const svgI = (k) => `<svg class="i" viewBox="0 0 24 24">${ICON[k] || ''}</svg>`;

export class Bench {
  constructor(root, { onExit }) {
    this.root = root; this.onExit = onExit;
    this.els = []; this.sel = null;
    this.opts = { partial: true, images: true, ext: true, vobj: false, density: 1, mono: false };
    this.view = { cx: 0, cy: 0, s: 2 }; // s：像素/mm（CSS 像素）
    this.measure = null; this.tool = null;
    this.buildDOM();
    this.load();
    this.resize();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this.cv.parentElement);
    this.keyH = (e) => this.onKey(e); window.addEventListener('keydown', this.keyH);
  }

  // ------------------------------------------------------------ 界面
  buildDOM() {
    const r = this.root;
    r.innerHTML = '';
    const page = h('div', 'bench');
    page.innerHTML = `
      <header class="topbar">
        <button class="btn" data-a="back" title="返回实验目录"><svg class="i" viewBox="0 0 16 16"><path d="M10 3 5 8l5 5"/></svg>目录</button>
        <div class="title"><b>光路设计台</b><small>二维光线追迹 · 菲涅耳反射 · 色散 · 成像</small></div>
        <span class="spacer"></span>
        <div class="tb-group">
          <select data-a="preset" title="预设光路"><option value="">预设光路…</option>${PRESETS.map((p) => `<option value="${p.id}">${p.title}</option>`).join('')}</select>
          <span class="tb-sep"></span>
          <button class="btn small" data-t="partial" title="界面上按菲涅耳公式计算部分反射">部分反射</button>
          <button class="btn small" data-t="images" title="标出相邻光线会聚的像点">像点</button>
          <button class="btn small" data-t="ext" title="虚像的反向延长线">延长线</button>
          <label class="tb-range" title="光线密度倍数">密度<input type="range" data-a="density" min="0.25" max="4" step="0.25" value="1"></label>
          <span class="tb-sep"></span>
          <button class="btn small" data-a="ruler" title="量尺：在平台上拖动测距离与角度">量尺</button>
          <button class="btn small" data-a="fit" title="缩放到全部元件">全景</button>
          <button class="btn small" data-a="clear" title="清空平台">清空</button>
          <button class="btn small" data-a="png" title="保存当前光路图">存图</button>
        </div>
      </header>
      <div class="bench-main">
        <aside class="bpanel bpal"></aside>
        <section class="bstage"><canvas></canvas><div class="bnote"></div><div class="bstat mono"></div><div class="bhelp">拖动元件移动 · 拖动箭头手柄旋转 · 滚轮缩放 · 拖动空白处平移 · Delete 删除 · 方向键微移（Shift×10）· [ ] 旋转 1°</div></section>
        <aside class="bpanel binsp"><div class="bi-el"></div><div class="bi-meas"></div></aside>
      </div>`;
    r.append(page);
    const q = (s) => page.querySelector(s);
    this.page = page; this.cv = q('canvas'); this.ctx = this.cv.getContext('2d');
    this.palEl = q('.bpal'); this.inspEl = q('.bi-el'); this.measEl = q('.bi-meas'); this.statEl = q('.bstat'); this.noteEl = q('.bnote');
    q('[data-a=back]').onclick = () => this.onExit && this.onExit();
    q('[data-a=preset]').onchange = (e) => { if (e.target.value) this.loadPreset(e.target.value); e.target.value = ''; };
    q('[data-a=density]').oninput = (e) => { this.opts.density = +e.target.value; this.changed(); };
    q('[data-a=fit]').onclick = () => { this.fit(); this.draw(); };
    q('[data-a=clear]').onclick = () => { if (!this.els.length || confirm('清空平台上的全部元件？')) { this.els = []; this.select(null); this.note(''); this.changed(); } };
    q('[data-a=png]').onclick = () => this.savePNG();
    q('[data-a=ruler]').onclick = (e) => { this.tool = this.tool === 'ruler' ? null : 'ruler'; e.currentTarget.classList.toggle('active', this.tool === 'ruler'); if (!this.tool) { this.measure = null; this.draw(); } };
    page.querySelectorAll('[data-t]').forEach((b) => {
      const k = b.dataset.t;
      b.classList.toggle('active', !!this.opts[k]);
      b.onclick = () => { this.opts[k] = !this.opts[k]; b.classList.toggle('active', this.opts[k]); this.changed(); };
    });
    this.renderPalette();
    this.bindPointer();
  }

  renderPalette() {
    const p = this.palEl;
    p.innerHTML = '';
    for (const g of GROUPS) {
      p.append(h('div', 'bp-h', g));
      const grid = h('div', 'bp-grid');
      for (const [k, T] of Object.entries(TYPES)) {
        if (T.group !== g) continue;
        const b = h('button', 'bp-item', `${svgI(k)}<span>${T.label}</span>`);
        b.title = `添加${T.label}`;
        b.onclick = () => this.add(k);
        grid.append(b);
      }
      p.append(grid);
    }
    p.append(h('div', 'bp-foot', '元件放在视野中央。透镜、棱镜可选 431 种 SCHOTT / OHARA / 成都光明玻璃，折射率按 Sellmeier 色散公式随波长变化。'));
  }

  note(t) { this.noteEl.innerHTML = t ? esc(t) : ''; this.noteEl.style.display = t ? '' : 'none'; }

  add(type, props = {}) {
    const el = makeElement(type, { x: Math.round(this.view.cx), y: Math.round(this.view.cy), ...props });
    this.els.push(el); this.select(el); this.changed();
    return el;
  }
  remove(el) { this.els = this.els.filter((e) => e !== el); if (this.sel === el) this.select(null); this.changed(); }

  loadPreset(id) {
    const P = PRESETS.find((p) => p.id === id);
    if (!P) return;
    this.els = P.build();
    if (P.opts) Object.assign(this.opts, P.opts), this.syncToggles();
    this.select(null);
    this.note(P.note);
    this.presetId = id;
    this.changed(false);
    this.fit(P.view);
    this.draw();
  }
  syncToggles() { this.page.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('active', !!this.opts[b.dataset.t])); }

  // ------------------------------------------------------------ 保存/载入
  save() { try { localStorage.setItem(STORE, JSON.stringify({ els: this.els, opts: this.opts, view: this.view, note: this.noteEl.textContent })); } catch { /* 存储满或禁用 */ } }
  load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { d = null; }
    if (d && Array.isArray(d.els) && d.els.length) {
      this.els = d.els.filter((e) => TYPES[e.type]).map((e) => makeElement(e.type, e));
      Object.assign(this.opts, d.opts || {}); this.syncToggles();
      if (d.view) this.view = d.view;
      this.note(d.note || '');
      this.changed(false);
    } else this.loadPreset('imaging');
  }

  // ------------------------------------------------------------ 追迹
  changed(save = true) {
    this.dirtyTrace = true;
    if (save) this.save();
    this.draw();
  }
  trace() {
    const t0 = performance.now();
    // 光线密度：按倍数调整光源的光线数（不改变元件参数本身）
    const k = this.opts.density;
    const els = k === 1 ? this.els : this.els.map((e) => (e.n != null ? { ...e, n: Math.max(1, Math.round(e.n * k)) } : e));
    this.cmp = compile(els);
    this.res = traceScene({ ...this.cmp, opts: { partial: this.opts.partial, minP: this.opts.partial ? 4e-3 : 1e-3 } });
    this.traceMs = performance.now() - t0;
    this.dirtyTrace = false;
    this.renderMeasure();
  }

  // ------------------------------------------------------------ 视图
  resize() {
    const box = this.cv.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = Math.max(50, box.width); this.H = Math.max(50, box.height); this.dpr = dpr;
    this.cv.width = Math.round(this.W * dpr); this.cv.height = Math.round(this.H * dpr);
    this.cv.style.width = this.W + 'px'; this.cv.style.height = this.H + 'px';
    this.draw();
  }
  toScreen(p) { return [this.W / 2 + (p[0] - this.view.cx) * this.view.s, this.H / 2 - (p[1] - this.view.cy) * this.view.s]; }
  toWorld(x, y) { return [this.view.cx + (x - this.W / 2) / this.view.s, this.view.cy - (y - this.H / 2) / this.view.s]; }
  fit(v) {
    if (v) { this.view.cx = v.cx; this.view.cy = v.cy; this.view.s = Math.max(0.05, (this.W || 800) / v.w); return; }
    if (!this.els.length) return;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const e of this.els) { x0 = Math.min(x0, e.x); x1 = Math.max(x1, e.x); y0 = Math.min(y0, e.y); y1 = Math.max(y1, e.y); }
    const w = Math.max(80, x1 - x0) * 1.4, hgt = Math.max(60, y1 - y0) * 1.6;
    this.view.cx = (x0 + x1) / 2; this.view.cy = (y0 + y1) / 2;
    this.view.s = Math.min(this.W / w, this.H / hgt);
  }

  // ------------------------------------------------------------ 绘制
  draw() {
    if (!this.W) return;
    if (this.dirtyTrace || !this.res) this.trace();
    const g = this.ctx, dpr = this.dpr, s = this.view.s;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#141817'; g.fillRect(0, 0, this.W, this.H);
    this.drawGrid(g);
    // 世界坐标变换：y 向上
    const W = () => g.setTransform(dpr * s, 0, 0, -dpr * s, dpr * (this.W / 2 - this.view.cx * s), dpr * (this.H / 2 + this.view.cy * s));
    W();
    // 玻璃
    for (const sh of this.cmp.shapes) if (sh.kind === 'glass') this.drawGlass(g, sh);
    // 光线（加法混色）
    this.drawRays(g);
    W();
    for (const sh of this.cmp.shapes) if (sh.kind !== 'glass') this.drawShape(g, sh);
    // 屏幕坐标：像点、选择框、量尺、标尺
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = 'source-over';
    if (this.opts.images) this.drawImages(g);
    this.drawSources(g);
    if (this.sel) this.drawSelection(g, this.sel);
    if (this.measure) this.drawRuler(g);
    this.drawScale(g);
    const st = this.res.stats;
    this.statEl.textContent = `光线段 ${st.segs}${st.cut ? '（已达上限）' : ''} · 全反射 ${st.tir} · 追迹 ${this.traceMs.toFixed(1)} ms${this.cursor ? ` · (${this.cursor[0].toFixed(1)}, ${this.cursor[1].toFixed(1)}) mm` : ''}`;
  }

  drawGrid(g) {
    // 光学平台：25 mm 间距的 M6 螺孔，10 mm 细格
    const s = this.view.s;
    const [x0, y1] = this.toWorld(0, 0), [x1, y0] = this.toWorld(this.W, this.H);
    const step = s * 10 >= 8 ? 10 : s * 50 >= 8 ? 50 : 250;
    g.strokeStyle = 'rgba(255,255,255,0.035)'; g.lineWidth = 1;
    g.beginPath();
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { const X = Math.round(this.toScreen([x, 0])[0]) + 0.5; g.moveTo(X, 0); g.lineTo(X, this.H); }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) { const Y = Math.round(this.toScreen([0, y])[1]) + 0.5; g.moveTo(0, Y); g.lineTo(this.W, Y); }
    g.stroke();
    if (s * 25 >= 9) {
      const r = Math.min(3.2, s * 3);
      g.fillStyle = '#0b0d0d';
      for (let x = Math.ceil(x0 / 25) * 25; x <= x1; x += 25) for (let y = Math.ceil(y0 / 25) * 25; y <= y1; y += 25) {
        const [X, Y] = this.toScreen([x, y]); g.beginPath(); g.arc(X, Y, r, 0, 7); g.fill();
      }
    }
    // 光轴（y = 0）
    const Y = this.toScreen([0, 0])[1];
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.setLineDash([6, 6]); g.beginPath(); g.moveTo(0, Y); g.lineTo(this.W, Y); g.stroke(); g.setLineDash([]);
  }

  pathEdges(g, edges) {
    g.beginPath();
    edges.forEach((e, i) => {
      if (e.type === 'line') { if (i === 0) g.moveTo(e.a[0], e.a[1]); g.lineTo(e.b[0], e.b[1]); } else g.arc(e.c[0], e.c[1], e.r, e.from, e.to, e.to < e.from);
    });
    g.closePath();
  }
  glassColor(mat) {
    let n = 1.5;
    try { n = index(mat, 587.56); } catch { /* 未知材料 */ }
    const k = Math.min(1, Math.max(0, (n - 1.3) / 0.6));
    return { fill: `rgba(${150 - 60 * k | 0},${190 - 40 * k | 0},${225 - 20 * k | 0},${0.1 + 0.16 * k})`, edge: `rgba(${180 - 40 * k | 0},${215 - 30 * k | 0},240,0.75)` };
  }
  drawGlass(g, sh) {
    const c = this.glassColor(sh.material);
    this.pathEdges(g, sh.edges);
    g.fillStyle = c.fill; g.fill();
    g.strokeStyle = c.edge; g.lineWidth = 1.2 / this.view.s; g.stroke();
  }
  drawShape(g, sh) {
    const px = 1 / this.view.s;
    const line = (geom, w, col, dash) => {
      g.beginPath();
      if (geom.type === 'line') { g.moveTo(...geom.a); g.lineTo(...geom.b); } else g.arc(geom.c[0], geom.c[1], geom.r, geom.a0, geom.a0 + geom.span);
      g.lineWidth = w * px; g.strokeStyle = col; g.setLineDash(dash ? dash.map((v) => v * px) : []); g.stroke(); g.setLineDash([]);
    };
    switch (sh.kind) {
      case 'mirror': case 'poly': {
        // 镜面背后画斜线表示镀膜背面
        if (sh.kind === 'poly') { g.beginPath(); sh.pts.forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p))); g.lineWidth = 2.4 * px; g.strokeStyle = '#d9dee2'; g.stroke(); }
        else line(sh.geom, 2.4, '#d9dee2', sh.ideal ? [5, 3] : null);
        break;
      }
      case 'splitter': line(sh.geom, 2, 'rgba(200,215,230,0.8)', [4, 2]); break;
      case 'blocker': line(sh.geom, 3.5, '#5d6560'); break;
      case 'grating': line(sh.geom, 3, '#9aa3ab', [1.5, 1.5]); break;
      case 'ideal': {
        line(sh.geom, 1.6, 'rgba(170,210,240,0.9)');
        const { a, b } = sh.geom, d = v2.norm(v2.sub(b, a)), nn = [-d[1], d[0]], k = 4 * px, sg = sh.f > 0 ? 1 : -1;
        for (const [p, dd] of [[a, d], [b, v2.mul(d, -1)]]) {
          g.beginPath();
          g.moveTo(p[0] + nn[0] * k + dd[0] * k * sg, p[1] + nn[1] * k + dd[1] * k * sg); g.lineTo(p[0], p[1]); g.lineTo(p[0] - nn[0] * k + dd[0] * k * sg, p[1] - nn[1] * k + dd[1] * k * sg);
          g.stroke();
        }
        break;
      }
      case 'detector': line(sh.geom, 3, '#e9ede6'); break;
      case 'source': if (sh.geom) line(sh.geom, 2, 'rgba(255,220,160,0.5)'); break;
      default: break;
    }
  }
  drawSources(g) {
    for (const el of this.els) {
      if (!['laser', 'beam', 'point'].includes(el.type)) continue;
      const [X, Y] = this.toScreen([el.x, el.y]);
      const col = el.white ? '#fff6e0' : rgbStr(wavelengthToRGB(el.lam), 1);
      g.save(); g.translate(X, Y); g.rotate(-(el.rot || 0) * D2R);
      if (el.type === 'laser') { g.fillStyle = '#2a2f2d'; g.strokeStyle = '#6d7671'; g.lineWidth = 1; g.fillRect(-26, -6, 26, 12); g.strokeRect(-26, -6, 26, 12); g.fillStyle = col; g.fillRect(-4, -2, 4, 4); }
      else if (el.type === 'point') { g.fillStyle = col; g.beginPath(); g.arc(0, 0, 4, 0, 7); g.fill(); g.strokeStyle = 'rgba(255,255,255,.4)'; g.beginPath(); g.arc(0, 0, 7, 0, 7); g.stroke(); }
      else { g.fillStyle = '#2a2f2d'; const hw = Math.max(6, (el.w * this.view.s) / 2); g.fillRect(-8, -hw, 8, 2 * hw); g.fillStyle = col; g.fillRect(-2, -hw, 2, 2 * hw); }
      g.restore();
    }
  }

  drawRays(g) {
    const segs = this.res.segs;
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    // 每个光源的光线数决定单条光线的亮度：光线越密，单条越暗，叠加后总亮度相近
    const nBySrc = new Map();
    for (const r of this.cmp.rays) nBySrc.set(r.src, (nBySrc.get(r.src) || 0) + 1);
    const lw = Math.max(1, 1.3) / this.view.s;
    g.lineWidth = lw;
    const colCache = new Map();
    const color = (lam) => { let c = colCache.get(lam); if (!c) { c = wavelengthToRGB(lam); colCache.set(lam, c); } return c; };
    for (const sgm of segs) {
      const n = nBySrc.get(sgm.src) || 1;
      const white = n > 1 && WHITE.includes(sgm.lam);
      const base = Math.min(1, 2.6 / Math.sqrt(n)) * (white ? 2.2 : 1);
      const a = Math.min(1, base * Math.pow(sgm.rel, 0.6));
      if (a < 0.01) continue;
      const c = color(sgm.lam);
      g.strokeStyle = rgbStr(c, a);
      g.beginPath(); g.moveTo(sgm.a[0], sgm.a[1]); g.lineTo(sgm.b[0], sgm.b[1]); g.stroke();
    }
    // 虚像的反向延长线
    if (this.opts.ext && this.opts.images) {
      g.globalCompositeOperation = 'source-over';
      g.setLineDash([3 / this.view.s, 3 / this.view.s]);
      g.lineWidth = 0.8 / this.view.s;
      const byKey = new Map();
      for (const sgm of segs) { const k = sgm.src + '|' + sgm.lam + '|' + sgm.sig; let a = byKey.get(k); if (!a) byKey.set(k, (a = [])); a.push(sgm); }
      for (const im of this.res.images) {
        if (im.type !== 'virtual' || !this.showImage(im)) continue;
        const arr = byKey.get(im.src + '|' + im.lam + '|' + im.sig) || [];
        g.strokeStyle = rgbStr(color(im.lam), 0.45);
        g.beginPath();
        for (const sgm of arr) { g.moveTo(sgm.a[0], sgm.a[1]); g.lineTo(im.p[0], im.p[1]); }
        g.stroke();
      }
      g.setLineDash([]);
    }
    g.globalCompositeOperation = 'source-over';
  }

  drawImages(g) {
    for (const im of this.res.images) {
      if (!this.showImage(im)) continue;
      const [X, Y] = this.toScreen(im.p);
      const c = rgbStr(wavelengthToRGB(im.lam), 1);
      g.lineWidth = 1.5;
      if (im.type === 'real') { g.fillStyle = c; g.beginPath(); g.arc(X, Y, 3.5, 0, 7); g.fill(); g.strokeStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(X, Y, 6, 0, 7); g.stroke(); }
      else { g.strokeStyle = c; g.setLineDash([2, 2]); g.beginPath(); g.arc(X, Y, 5, 0, 7); g.stroke(); g.setLineDash([]); }
    }
  }

  /** 只标出较强光线形成的像（部分反射形成的弱“鬼像”不标），虚物默认不标 */
  // 实像：光线在空气中会聚处；虚像：最后一段光线（观察者看到的光）的反向延长线交点。玻璃内部或元件之间的中间虚像不标。
  showImage(im) {
    if (im.rel <= 0.12) return false;
    if (im.type === 'vobject') return this.opts.vobj;
    if (im.nMed > 1.0001 && !this.els.some((e) => e.type === 'tank')) return false;
    return im.type === 'real' || im.final;
  }

  elBounds(el) {
    // 选择框：元件的所有形状/玻璃顶点在屏幕上的包围盒
    const pts = [];
    for (const sh of this.cmp.shapes) {
      if (sh.obj !== el.id) continue;
      if (sh.edges) for (const e of sh.edges) { if (e.type === 'line') pts.push(e.a, e.b); else { for (let k = 0; k <= 8; k++) { const a = e.from + ((e.to - e.from) * k) / 8; pts.push([e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a)]); } } }
      if (sh.geom) { if (sh.geom.type === 'line') pts.push(sh.geom.a, sh.geom.b); else for (let k = 0; k <= 8; k++) { const a = sh.geom.a0 + (sh.geom.span * k) / 8; pts.push([sh.geom.c[0] + sh.geom.r * Math.cos(a), sh.geom.c[1] + sh.geom.r * Math.sin(a)]); } }
      if (sh.pts) pts.push(...sh.pts);
    }
    pts.push([el.x, el.y]);
    const S = pts.map((p) => this.toScreen(p));
    const xs = S.map((p) => p[0]), ys = S.map((p) => p[1]);
    return { x0: Math.min(...xs) - 6, x1: Math.max(...xs) + 6, y0: Math.min(...ys) - 6, y1: Math.max(...ys) + 6 };
  }
  handlePos(el) {
    const [X, Y] = this.toScreen([el.x, el.y]);
    const b = this.elBounds(el);
    const r = Math.max(34, Math.hypot(b.x1 - b.x0, b.y1 - b.y0) / 2 + 16);
    const a = (el.rot || 0) * D2R;
    return { X, Y, HX: X + r * Math.cos(a), HY: Y - r * Math.sin(a) };
  }
  drawSelection(g, el) {
    const b = this.elBounds(el);
    g.strokeStyle = 'rgba(196,30,58,.9)'; g.lineWidth = 1; g.setLineDash([4, 3]);
    g.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); g.setLineDash([]);
    const { X, Y, HX, HY } = this.handlePos(el);
    g.strokeStyle = 'rgba(196,30,58,.9)'; g.beginPath(); g.moveTo(X, Y); g.lineTo(HX, HY); g.stroke();
    g.fillStyle = '#c41e3a'; g.beginPath(); g.arc(HX, HY, 5, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(X, Y, 2.5, 0, 7); g.fill();
    g.font = '11px "IBM Plex Mono", monospace'; g.fillStyle = 'rgba(255,255,255,.75)';
    g.fillText(`${fmt(el.rot, 1)}°`, HX + 8, HY + 4);
  }
  drawRuler(g) {
    const m = this.measure;
    const A = this.toScreen(m.a), B = this.toScreen(m.b);
    g.strokeStyle = '#f2c14e'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(...A); g.lineTo(...B); g.stroke();
    for (const P of [A, B]) { g.beginPath(); g.arc(P[0], P[1], 3, 0, 7); g.stroke(); }
    const d = v2.sub(m.b, m.a), L = v2.len(d), ang = Math.atan2(d[1], d[0]) * R2D;
    const txt = `${L.toFixed(2)} mm  ${ang.toFixed(2)}°`;
    g.font = '12px "IBM Plex Mono", monospace';
    const w = g.measureText(txt).width;
    g.fillStyle = 'rgba(0,0,0,.65)'; g.fillRect(B[0] + 8, B[1] - 18, w + 10, 18);
    g.fillStyle = '#f2c14e'; g.fillText(txt, B[0] + 13, B[1] - 5);
  }
  drawScale(g) {
    const s = this.view.s;
    const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    const L = nice.find((v) => v * s >= 70) || 1000;
    const x = 16, y = this.H - 18;
    g.strokeStyle = '#cfd6d1'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x, y); g.lineTo(x + L * s, y); g.lineTo(x + L * s, y - 4); g.stroke();
    g.font = '11px "IBM Plex Mono", monospace'; g.fillStyle = '#cfd6d1'; g.fillText(`${L} mm`, x + 4, y - 6);
  }

  // ------------------------------------------------------------ 交互
  bindPointer() {
    const cv = this.cv;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      const [x, y] = pos(e), w = this.toWorld(x, y);
      if (this.tool === 'ruler') { this.drag = { ruler: true }; this.measure = { a: w, b: w }; this.draw(); return; }
      if (this.sel) {
        const { HX, HY } = this.handlePos(this.sel);
        if (Math.hypot(x - HX, y - HY) < 9) { this.drag = { rotate: true, el: this.sel }; return; }
      }
      const el = this.pick(w, x, y);
      if (el) {
        this.select(el);
        this.drag = e.shiftKey ? { rotate: true, el } : { move: true, el, off: [w[0] - el.x, w[1] - el.y] };
      } else { this.select(null); this.drag = { pan: true, x, y, cx: this.view.cx, cy: this.view.cy }; }
      this.draw();
    });
    cv.addEventListener('pointermove', (e) => {
      const [x, y] = pos(e), w = this.toWorld(x, y);
      this.cursor = w;
      const d = this.drag;
      if (!d) { this.draw(); return; }
      if (d.ruler) { this.measure.b = w; }
      else if (d.pan) { this.view.cx = d.cx - (x - d.x) / this.view.s; this.view.cy = d.cy + (y - d.y) / this.view.s; }
      else if (d.move) {
        // 移动时吸附到 0.5 mm；按住 Alt 不吸附
        const sn = e.altKey ? 0 : this.view.s > 4 ? 0.1 : 0.5;
        const rx = w[0] - d.off[0], ry = w[1] - d.off[1];
        d.el.x = sn ? Math.round(rx / sn) * sn : rx; d.el.y = sn ? Math.round(ry / sn) * sn : ry;
        this.dirtyTrace = true; this.refreshInsp();
      } else if (d.rotate) {
        const [X, Y] = this.toScreen([d.el.x, d.el.y]);
        let a = Math.atan2(-(y - Y), x - X) * R2D;
        a = e.altKey ? a : Math.round(a / (e.shiftKey ? 15 : 0.5)) * (e.shiftKey ? 15 : 0.5);
        d.el.rot = a; this.dirtyTrace = true; this.refreshInsp();
      }
      this.draw();
    });
    const up = () => { if (this.drag && (this.drag.move || this.drag.rotate)) this.save(); this.drag = null; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { this.cursor = null; });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [x, y] = pos(e), w0 = this.toWorld(x, y);
      this.view.s = Math.min(400, Math.max(0.05, this.view.s * Math.exp(-e.deltaY * 0.0015)));
      const w1 = this.toWorld(x, y);
      this.view.cx += w0[0] - w1[0]; this.view.cy += w0[1] - w1[1];
      this.draw();
    }, { passive: false });
  }
  pick(w, x, y) {
    const tol = 7 / this.view.s;
    // 先找光源（点）、再找线/弧、最后找玻璃内部；后添加的优先
    for (let i = this.els.length - 1; i >= 0; i--) {
      const el = this.els[i];
      if (['laser', 'point'].includes(el.type)) { const [X, Y] = this.toScreen([el.x, el.y]); if (Math.hypot(x - X, y - Y) < 12) return el; }
    }
    for (let i = this.cmp.surfaces.length - 1; i >= 0; i--) {
      const s = this.cmp.surfaces[i];
      if (distGeom(s.geom, w) < tol) return this.els.find((e) => e.id === s.obj);
    }
    for (let i = this.cmp.shapes.length - 1; i >= 0; i--) {
      const sh = this.cmp.shapes[i];
      if (sh.kind === 'source' && sh.geom && distGeom(sh.geom, w) < tol) return this.els.find((e) => e.id === sh.obj);
    }
    for (let i = this.cmp.bodies.length - 1; i >= 0; i--) if (inside(this.cmp.bodies[i], w)) return this.els.find((e) => e.id === this.cmp.bodies[i].obj);
    return null;
  }
  onKey(e) {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
    const el = this.sel;
    if (!el) return;
    const st = e.shiftKey ? 10 : 1;
    let hit = true;
    if (e.key === 'Delete' || e.key === 'Backspace') this.remove(el);
    else if (e.key === 'ArrowLeft') el.x -= st; else if (e.key === 'ArrowRight') el.x += st;
    else if (e.key === 'ArrowUp') el.y += st; else if (e.key === 'ArrowDown') el.y -= st;
    else if (e.key === '[') el.rot = (el.rot || 0) + st; else if (e.key === ']') el.rot = (el.rot || 0) - st;
    else hit = false;
    if (hit) { e.preventDefault(); this.refreshInsp(); this.changed(); }
  }

  // ------------------------------------------------------------ 属性面板
  select(el) { this.sel = el; this.renderInsp(); }
  refreshInsp() { if (this.inspRefresh) this.inspRefresh(); }
  renderInsp() {
    const box = this.inspEl;
    box.innerHTML = '';
    this.inspRefresh = null;
    const el = this.sel;
    if (!el) {
      box.innerHTML = `<div class="bi-h">元件属性</div><p class="bi-empty">单击平台上的元件查看和修改参数；从左侧元件库添加新元件。</p>`;
      return;
    }
    const T = TYPES[el.type];
    box.append(h('div', 'bi-h', `${svgI(el.type)}<span>${T.label}</span>`));
    const form = h('div', 'bi-form');
    const inputs = [];
    const numRow = (k, label, unit = '', step = 1, opt = {}) => {
      const row = h('label', 'bi-row', `<span>${label}</span>`);
      const inp = h('input'); inp.type = 'number'; inp.step = step;
      if (opt.min != null) inp.min = opt.min; if (opt.max != null) inp.max = opt.max;
      inp.value = +(+el[k]).toFixed(4);
      inp.onchange = () => { let v = parseFloat(inp.value); if (!isFinite(v)) return; if (opt.min != null) v = Math.max(opt.min, v); if (opt.max != null) v = Math.min(opt.max, v); el[k] = v; this.changed(); this.renderLensInfo(); };
      row.append(inp, h('em', null, unit));
      if (opt.hint) row.title = opt.hint;
      inputs.push(() => { if (document.activeElement !== inp) inp.value = +(+el[k]).toFixed(4); });
      form.append(row);
    };
    numRow('x', 'x', 'mm', 0.5); numRow('y', 'y', 'mm', 0.5); numRow('rot', '转角', '°', 0.5);
    for (const p of T.params) {
      if (p.hideIf && p.hideIf(el)) continue;
      if (p.type === 'bool') {
        const row = h('label', 'bi-row bi-chk', `<span>${p.label}</span>`);
        const inp = h('input'); inp.type = 'checkbox'; inp.checked = !!el[p.k];
        inp.onchange = () => { el[p.k] = inp.checked; this.changed(); this.renderInsp(); };
        row.append(inp); form.append(row);
      } else if (p.type === 'glass') {
        const row = h('label', 'bi-row', `<span>${p.label}</span>`);
        row.append(glassSelect(el[p.k], (v) => { el[p.k] = v; this.changed(); this.renderInsp(); }));
        form.append(row);
        form.append(h('div', 'bi-sub', glassInfo(el[p.k])));
      } else if (p.type === 'select') {
        const row = h('label', 'bi-row', `<span>${p.label}</span>`);
        const sel = h('select');
        for (const [v, t] of p.options()) { const o = h('option', null, esc(t)); o.value = v; if (v === el[p.k]) o.selected = true; sel.append(o); }
        sel.onchange = () => { el[p.k] = sel.value; this.changed(); this.renderInsp(); };
        row.append(sel); form.append(row);
      } else numRow(p.k, p.label, p.unit || '', p.step ?? 1, p);
    }
    box.append(form);
    this.lensInfoEl = h('div', 'bi-lens'); box.append(this.lensInfoEl);
    this.renderLensInfo();
    const act = h('div', 'bi-act');
    const dup = h('button', 'btn small', '复制'); dup.onclick = () => { const nn = makeElement(el.type, { ...el, x: el.x + 10, y: el.y - 10 }); this.els.push(nn); this.select(nn); this.changed(); };
    const del = h('button', 'btn small', '删除'); del.onclick = () => this.remove(el);
    act.append(dup, del); box.append(act);
    this.inspRefresh = () => inputs.forEach((f) => f());
  }
  /** 透镜：用精确光线追迹库算有效焦距、后截距和赛德尔像差 */
  renderLensInfo() {
    const el = this.sel, box = this.lensInfoEl;
    if (!box) return;
    box.innerHTML = '';
    let L = null;
    const R = (r) => (r === 0 ? Infinity : r);
    if (el.type === 'lens') L = { epd: el.D * 0.9, field: 3, surfaces: [{ R: R(el.R1), t: el.d, glass: el.mat, stop: true }, { R: R(el.R2), t: 100, glass: 'air' }] };
    else if (el.type === 'achromat') L = { epd: el.D * 0.9, field: 3, surfaces: [{ R: R(el.R1), t: el.d1, glass: el.mat1, stop: true }, { R: R(el.R2), t: el.d2, glass: el.mat2 }, { R: R(el.R3), t: 100, glass: 'air' }] };
    else if (el.type === 'camera') { const B = LENSES[el.design]; const k = el.scale || 1; L = { epd: B.epd * k, field: B.field, surfaces: B.surfaces.map((s) => ({ ...s, R: s.R * k, t: s.t * k })) }; }
    if (!L) return;
    try {
      const pd = paraxial(L, 587.56), pF = paraxial(L, 486.13), pC = paraxial(L, 656.27);
      const sd = seidel(L, 587.56);
      const lastV = pd.zv[pd.zv.length - 1];
      const half = el.type === 'camera' ? lastV / 2 : (el.type === 'lens' ? el.d / 2 : (el.d1 + el.d2) / 2);
      // W040 = S_I/8（波面球差，mm）→ 以 λ 计
      const W040 = (sd.total.SI / 8) / 587.56e-6;
      box.innerHTML = `<div class="bi-h2">近轴参数（d 光 587.6 nm，逐面计算）</div>
        <table class="bi-tab">
          <tr><td>有效焦距 f′</td><td>${fmt(pd.efl, 2)} mm</td></tr>
          <tr><td>后截距 l′<sub>F</sub></td><td>${fmt(pd.bfl, 2)} mm</td></tr>
          <tr><td>后焦点 x</td><td>${fmt(el.x + (lastV - half + pd.bfl) * Math.cos((el.rot || 0) * D2R), 2)} mm</td></tr>
          <tr><td>相对孔径</td><td>F/${fmt(pd.fnum, 1)}（按 ${fmt(L.epd, 1)} mm 通光）</td></tr>
          <tr><td>轴向色差 f′<sub>C</sub>−f′<sub>F</sub></td><td>${fmt(pC.bfl - pF.bfl, 3)} mm</td></tr>
          <tr><td>初级球差 W<sub>040</sub></td><td>${fmt(W040, 1)} λ</td></tr>
          <tr><td>佩茨瓦尔和</td><td>${fmt(pd.petzval * 1000, 3)} ×10⁻³/mm</td></tr>
        </table>`;
    } catch (err) { box.innerHTML = '<p class="bi-empty">该组参数无法计算近轴量（曲率与厚度不协调）。</p>'; }
  }

  // ------------------------------------------------------------ 测量面板
  renderMeasure() {
    const box = this.measEl;
    if (!box) return;
    const dets = this.els.filter((e) => e.type === 'detector');
    const imgs = this.res.images.filter((im) => this.showImage(im));
    let html = '<div class="bi-h">测量</div>';
    if (!dets.length && !imgs.length) html += '<p class="bi-empty">放一块光屏（探测器）可以看到落在上面的光强分布；会聚的光线会自动标出像点。</p>';
    box.innerHTML = html;
    for (const d of dets) {
      const hs = [];
      for (const s of this.cmp.surfaces) if (s.obj === d.id) hs.push(...(this.res.hits.get(s.id) || []));
      const ir = irradiance(hs, d.L, 160);
      const card = h('div', 'bm-det');
      const ps = hs.reduce((a, x) => a + x.P, 0);
      let sx = 0, sxx = 0;
      for (const x of hs) { const u = (x.s - 0.5) * d.L; sx += x.P * u; sxx += x.P * u * u; }
      const mu = ps > 0 ? sx / ps : NaN, rms = ps > 0 ? Math.sqrt(Math.max(0, sxx / ps - mu * mu)) : NaN;
      card.innerHTML = `<div class="bm-t">光屏 @ (${fmt(d.x, 1)}, ${fmt(d.y, 1)})</div>`;
      const cv = h('canvas'); cv.width = 260; cv.height = 96; card.append(cv);
      card.append(h('div', 'bm-n mono', `功率 ${fmt(ps, 4)} · 质心 ${fmt(mu, 2)} mm · RMS 半宽 ${fmt(rms, 3)} mm`));
      box.append(card);
      drawIrr(cv, ir, d.L);
      if (this.sel === d) card.classList.add('on');
    }
    if (imgs.length) {
      // 白光：同一光源、同一路径的各波长像点合成一行，给出位置范围（即色差）
      const grp = new Map();
      for (const im of imgs) { const k = im.src + '|' + im.sig + '|' + im.type; let a = grp.get(k); if (!a) grp.set(k, (a = [])); a.push(im); }
      const rows = [...grp.values()].slice(0, 12).map((a) => {
        a.sort((p, q) => p.lam - q.lam);
        const im = a[Math.floor(a.length / 2)], kind = im.type === 'real' ? '实像' : im.type === 'virtual' ? '虚像' : '虚物';
        const dot = a.length > 1 ? `<i class="sp"></i>` : `<i style="background:${rgbStr(wavelengthToRGB(im.lam), 1)}"></i>`;
        const rng = (f) => { const v = a.map(f); const lo = Math.min(...v), hi = Math.max(...v); return hi - lo > 0.005 ? `${fmt(lo, 2)}~${fmt(hi, 2)}` : fmt(lo, 2); };
        const sp = Math.max(...a.map((x) => x.spread)), bl = Math.max(...a.map((x) => x.blur || 0));
        return `<tr title="${a.length > 1 ? `${a[0].lam}–${a[a.length - 1].lam} nm 共 ${a.length} 个波长` : im.lam + ' nm'}"><td>${dot}${kind}</td><td>${rng((x) => x.p[0])}</td><td>${rng((x) => x.p[1])}</td><td>${fmt(sp, 3)}${bl > 3 * sp + 0.05 ? `<small>（${fmt(bl, 2)}）</small>` : ''}</td></tr>`;
      }).join('');
      const t = h('div', 'bm-imgs');
      t.innerHTML = `<div class="bm-t">像点（相邻光线交点）</div><table class="bi-tab"><tr><th>类型</th><th>x/mm</th><th>y/mm</th><th title="近轴光线交点的离散；括号内为全部光线的最大偏离">弥散/mm</th></tr>${rows}</table>${grp.size > 12 ? `<p class="bi-empty">另有 ${grp.size - 12} 组</p>` : ''}<p class="bi-empty">白光的像按波长给出位置范围，即色差。</p>`;
      box.append(t);
    }
  }

  savePNG() {
    const a = document.createElement('a');
    a.download = '光路图.png';
    a.href = this.cv.toDataURL('image/png');
    a.click();
  }

  dispose() {
    window.removeEventListener('keydown', this.keyH);
    this.ro && this.ro.disconnect();
    this.root.innerHTML = '';
  }
}

// ---------------------------------------------------------------- 工具函数
function rgbStr(c, a) { return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`; }

function distGeom(g, p) {
  if (g.type === 'line') {
    const e = v2.sub(g.b, g.a), L2 = v2.dot(e, e) || 1;
    const t = Math.max(0, Math.min(1, v2.dot(v2.sub(p, g.a), e) / L2));
    return v2.len(v2.sub(p, v2.add(g.a, v2.mul(e, t))));
  }
  const d = v2.sub(p, g.c), ang = Math.atan2(d[1], d[0]);
  const rel = (((ang - g.a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (rel <= g.span) return Math.abs(v2.len(d) - g.r);
  const e0 = [g.c[0] + g.r * Math.cos(g.a0), g.c[1] + g.r * Math.sin(g.a0)], e1 = [g.c[0] + g.r * Math.cos(g.a0 + g.span), g.c[1] + g.r * Math.sin(g.a0 + g.span)];
  return Math.min(v2.len(v2.sub(p, e0)), v2.len(v2.sub(p, e1)));
}
void hitGeom;

function glassSelect(value, onChange) {
  const sel = document.createElement('select');
  const add = (parent, v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; if (v === value) o.selected = true; parent.append(o); };
  const g0 = document.createElement('optgroup'); g0.label = '常用';
  for (const k of COMMON) add(g0, k, labelOf(k));
  sel.append(g0);
  const makers = { CDGM: '成都光明 CDGM', SCHOTT: 'SCHOTT', OHARA: 'OHARA' };
  for (const [m, title] of Object.entries(makers)) {
    const og = document.createElement('optgroup'); og.label = title;
    for (const k of Object.keys(CATALOGUE).filter((n) => CATALOGUE[n][0] === m).sort()) add(og, k, labelOf(k));
    sel.append(og);
  }
  if (![...sel.options].some((o) => o.value === value)) add(sel, value, labelOf(value));
  sel.onchange = () => onChange(sel.value);
  return sel;
}
function labelOf(k) {
  let nd = '';
  try { nd = index(k, 587.56).toFixed(4); } catch { nd = '?'; }
  const alias = ALIASES[k] ? `（${ALIASES[k]}）` : '';
  const cn = { Water: '水', PMMA: '有机玻璃', 'Fused silica': '熔石英', CaF2: '萤石 CaF₂', Diamond: '金刚石' }[k];
  return `${cn || k}${alias}  n=${nd}`;
}
function glassInfo(k) {
  try {
    const G = glassData(k);
    const nd = index(k, 587.56), nF = index(k, 486.13), nC = index(k, 656.27), vd = abbe(k);
    return `n<sub>d</sub>=${nd.toFixed(5)} · ν<sub>d</sub>=${vd.toFixed(2)} · n<sub>F</sub>−n<sub>C</sub>=${(nF - nC).toFixed(5)}${G && G.type ? ' · ' + typeCN(G.type) : ''}`;
  } catch { return '未知材料'; }
}
void GLASS_NAMES;

function drawIrr(cv, ir, L) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.fillStyle = '#0d1110'; g.fillRect(0, 0, W, H);
  const n = ir.P.length;
  let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, ir.P[i]);
  // 下方色条：光屏上看到的颜色与亮度
  const sh = 18;
  for (let i = 0; i < n; i++) {
    if (ir.P[i] <= 0) continue;
    const c = wavelengthToRGB(ir.lam[i]), k = Math.min(1, Math.sqrt(ir.P[i] / mx) * 1.2);
    g.fillStyle = rgbStr(c, k); g.fillRect((i * W) / n, H - sh, Math.ceil(W / n) + 0.5, sh);
  }
  // 光强曲线
  g.strokeStyle = '#e9ede6'; g.lineWidth = 1;
  g.beginPath();
  for (let i = 0; i < n; i++) { const x = ((i + 0.5) * W) / n, y = H - sh - 4 - (mx > 0 ? (ir.P[i] / mx) * (H - sh - 12) : 0); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
  g.stroke();
  g.fillStyle = 'rgba(233,237,230,.55)'; g.font = '10px "IBM Plex Mono", monospace';
  g.fillText(`−${(L / 2).toFixed(0)}`, 2, 10); g.fillText(`+${(L / 2).toFixed(0)} mm`, W - 48, 10);
}
