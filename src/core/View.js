// 观察窗：可拖动改变大小、滚轮/双指放大、拖动平移；画布分辨率随显示尺寸自动调整，放大后依然清晰。
// 实验代码始终在“逻辑坐标”（W×H，创建时确定）里作图，这里用一个底层变换把逻辑坐标映射到实际像素。
import { h } from './Controls.js';

const P = CanvasRenderingContext2D.prototype;
const D_FILTER = Object.getOwnPropertyDescriptor(P, 'filter');
const D_SBLUR = Object.getOwnPropertyDescriptor(P, 'shadowBlur');
const D_SOX = Object.getOwnPropertyDescriptor(P, 'shadowOffsetX');
const D_SOY = Object.getOwnPropertyDescriptor(P, 'shadowOffsetY');
const scaleBlur = (v, s) => (typeof v === 'string' && s !== 1 ? v.replace(/blur\(\s*([\d.]+)px\s*\)/g, (_, n) => `blur(${(+n * s).toFixed(2)}px)`) : v);

const ZMAX = 8;
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 无痕模式等 */ } },
};

export class ObsView {
  constructor(app, { id, title, w = 260, h: hh = 260, res = 1, foot = true }) {
    this.app = app; this.id = id; this.title = title;
    this.w = w; this.h = hh;
    this.W = Math.round(w * res); this.H = Math.round(hh * res); // 逻辑作图尺寸（与旧接口一致）
    this.k = 1; this.zoom = 1; this.cx = this.W / 2; this.cy = this.H / 2;
    this.key = `vsz:${app.meta.id}:${id}`;
    const el = (this.el = h('div', 'vw'));
    el.innerHTML = `<div class="vh"><b>${title}</b><span class="vz"></span><button data-v="big" title="放大到屏幕中央">⤢</button><button data-v="min" title="收起">–</button></div>`;
    const cv = (this.canvas = h('canvas'));
    const wrap = h('div', 'vcv');
    wrap.append(cv);
    const grip = h('div', 'vgrip'); grip.title = '拖动改变大小（双击恢复）';
    wrap.append(grip);
    el.append(wrap);
    this.ft = h('div', 'vfoot', '');
    if (foot) el.append(this.ft);
    this.zl = el.querySelector('.vz');
    app.viewsEl.append(el);
    this.cssW = (store.get(this.key) || {}).w || w;
    this.applyCss();
    this.ctx = cv.getContext('2d');
    this.patch();
    cv.width = this.W; cv.height = this.H;
    this.base();
    el.querySelector('[data-v=big]').onclick = () => this.toggleBig();
    el.querySelector('[data-v=min]').onclick = () => el.classList.toggle('min');
    this.bindResize(grip);
    this.bindZoom();
    this._ro = new ResizeObserver(() => this.fit());
    this._ro.observe(cv);
  }

  // ---------- 旧接口 ----------
  foot(t) { if (this.ft.textContent !== t) this.ft.textContent = t; }
  show(on) { this.el.style.display = on ? '' : 'none'; }
  visible() { return this.el.style.display !== 'none'; }

  /** 逻辑坐标 → 画布像素的缩放与平移 */
  get M() {
    const s = this.k * this.zoom;
    return [s, this.canvas.width / 2 - s * this.cx, this.canvas.height / 2 - s * this.cy];
  }
  /** 每个逻辑单位对应多少实际像素（像素级计算可按它提高分辨率） */
  get scale() { return this.k * this.zoom; }
  /** 当前可见的逻辑矩形 [x, y, w, h]（放大后只需计算这一块） */
  visRect() {
    const [s, tx, ty] = this.M;
    const x0 = Math.max(0, -tx / s), y0 = Math.max(0, -ty / s);
    const x1 = Math.min(this.W, (this.canvas.width - tx) / s), y1 = Math.min(this.H, (this.canvas.height - ty) / s);
    return [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
  }

  patch() {
    const g = this.ctx, self = this;
    const nSet = P.setTransform.bind(g), nDraw = P.drawImage.bind(g);
    this.nativeSet = nSet;
    g.setTransform = function (a, b, c, d, e, f) {
      if (a && typeof a === 'object') ({ a, b, c, d, e, f } = a);
      const [s, tx, ty] = self.M;
      nSet(s * a, s * b, s * c, s * d, s * e + tx, s * f + ty);
    };
    g.resetTransform = () => g.setTransform(1, 0, 0, 1, 0, 0);
    // putImageData 不受变换影响：改成经离屏画布按当前变换绘制（与逻辑坐标一致）
    const off = document.createElement('canvas'), oc = off.getContext('2d');
    g.putImageData = function (img, x = 0, y = 0) {
      if (off.width !== img.width || off.height !== img.height) { off.width = img.width; off.height = img.height; }
      oc.putImageData(img, 0, 0);
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1; g.globalCompositeOperation = 'copy';
      if (D_FILTER) D_FILTER.set.call(g, 'none');
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      // copy 会清掉绘制区域以外的像素，只在整幅覆盖时使用
      if (x !== 0 || y !== 0 || img.width < self.W || img.height < self.H) g.globalCompositeOperation = 'source-over';
      nDraw(off, x, y);
      g.restore();
    };
    // 模糊半径等以像素计、不随变换缩放：按当前比例换算，保证放大前后效果一致
    const s = () => self.k * self.zoom;
    if (D_FILTER) Object.defineProperty(g, 'filter', { configurable: true, get: () => D_FILTER.get.call(g), set: (v) => D_FILTER.set.call(g, scaleBlur(v, s())) });
    if (D_SBLUR) Object.defineProperty(g, 'shadowBlur', { configurable: true, get: () => D_SBLUR.get.call(g) / s(), set: (v) => D_SBLUR.set.call(g, v * s()) });
    if (D_SOX) Object.defineProperty(g, 'shadowOffsetX', { configurable: true, get: () => D_SOX.get.call(g) / s(), set: (v) => D_SOX.set.call(g, v * s()) });
    if (D_SOY) Object.defineProperty(g, 'shadowOffsetY', { configurable: true, get: () => D_SOY.get.call(g) / s(), set: (v) => D_SOY.set.call(g, v * s()) });
  }
  /** 恢复底层变换（每帧作图前调用） */
  base() { this.ctx.setTransform(1, 0, 0, 1, 0, 0); }
  /** 对画布当前内容整体施加滤镜（例如离焦模糊），不受缩放影响 */
  filterSelf(filter) {
    const g = this.ctx, cv = this.canvas;
    const tmp = this._tmp || (this._tmp = document.createElement('canvas'));
    tmp.width = cv.width; tmp.height = cv.height;
    tmp.getContext('2d').drawImage(cv, 0, 0);
    g.save(); this.nativeSet(1, 0, 0, 1, 0, 0);
    if (D_FILTER) D_FILTER.set.call(g, scaleBlur(filter, this.k * this.zoom));
    g.drawImage(tmp, 0, 0);
    g.restore();
  }

  applyCss() {
    const max = Math.max(160, Math.min(window.innerWidth * 0.72, 1100));
    this.cssW = Math.max(120, Math.min(max, this.cssW));
    if (this.el.classList.contains('big')) return;
    this.canvas.style.width = this.cssW + 'px';
    this.canvas.style.height = (this.cssW * this.h) / this.w + 'px';
  }

  /** 按显示尺寸重设画布分辨率 */
  fit() {
    const cv = this.canvas;
    const cw = cv.clientWidth;
    if (!cw) return;
    const q = this.app.quality ? this.app.quality.viewScale : 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    let bw = cw * dpr * q;
    const maxPx = this.app.quality ? this.app.quality.viewMaxPx : 1.6e6;
    const ar = this.H / this.W;
    if (bw * bw * ar > maxPx) bw = Math.sqrt(maxPx / ar);
    bw = Math.max(32, Math.round(bw));
    const bh = Math.max(16, Math.round(bw * ar));
    if (Math.abs(bw - cv.width) < 2 && Math.abs(bh - cv.height) < 2) return;
    cv.width = bw; cv.height = bh; // 会重置画布状态
    this.k = bw / this.W;
    this.base();
    this.refreshTextures();
    this.app.changed();
  }
  /** 场景里直接以本画布为贴图的材质需要重新分配显存 */
  refreshTextures() {
    const sc = this.app.stage && this.app.stage.scene;
    if (!sc) return;
    sc.traverse((o) => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) for (const k of ['map', 'emissiveMap']) if (m[k] && m[k].image === this.canvas) { m[k].dispose(); m[k].needsUpdate = true; }
    });
  }

  setZoom(z, px, py) {
    // (px,py)：画布上保持不动的点（CSS 像素）；缺省为中心
    const cv = this.canvas, r = cv.getBoundingClientRect();
    z = Math.max(1, Math.min(ZMAX, z));
    if (px != null) {
      const fx = (px - r.left) / r.width - 0.5, fy = (py - r.top) / r.height - 0.5;
      const lx = this.cx + (fx * this.W) / this.zoom, ly = this.cy + (fy * this.H) / this.zoom;
      this.zoom = z;
      this.cx = lx - (fx * this.W) / z; this.cy = ly - (fy * this.H) / z;
    } else this.zoom = z;
    this.clampPan();
    this.zl.textContent = this.zoom > 1.01 ? `${this.zoom.toFixed(1)}×` : '';
    this.el.classList.toggle('zoomed', this.zoom > 1.01);
    this.base(); this.app.changed();
  }
  clampPan() {
    const hw = this.W / (2 * this.zoom), hh = this.H / (2 * this.zoom);
    this.cx = Math.max(hw, Math.min(this.W - hw, this.cx));
    this.cy = Math.max(hh, Math.min(this.H - hh, this.cy));
  }

  bindZoom() {
    const cv = this.canvas;
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
    }, { passive: false });
    cv.addEventListener('dblclick', () => { this.cx = this.W / 2; this.cy = this.H / 2; this.setZoom(1); });
    const pts = new Map();
    let last = null;
    cv.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      cv.setPointerCapture(e.pointerId);
      last = null;
    });
    cv.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const p0 = pts.get(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const r = cv.getBoundingClientRect();
      if (pts.size === 1 && this.zoom > 1.01) {
        this.cx -= ((e.clientX - p0.x) / r.width) * (this.W / this.zoom);
        this.cy -= ((e.clientY - p0.y) / r.height) * (this.H / this.zoom);
        this.clampPan(); this.base(); this.app.changed();
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (last) this.setZoom(this.zoom * (d / last), (a.x + b.x) / 2, (a.y + b.y) / 2);
        last = d;
      }
    });
    const up = (e) => { pts.delete(e.pointerId); last = null; };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.style.touchAction = 'none';
  }

  bindResize(grip) {
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (this.el.classList.contains('big')) return;
      const x0 = e.clientX, y0 = e.clientY, w0 = this.cssW, ar = this.h / this.w;
      // 窗口贴在右侧：向左下拖动变大
      const mv = (ev) => {
        const dx = x0 - ev.clientX, dy = (ev.clientY - y0) / ar;
        this.cssW = w0 + (Math.abs(dx) > Math.abs(dy) ? dx : dy);
        this.applyCss();
      };
      const upf = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', upf); store.set(this.key, { w: Math.round(this.cssW) }); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', upf);
    });
    grip.addEventListener('dblclick', () => { this.cssW = this.w; this.applyCss(); store.set(this.key, null); });
  }

  toggleBig() {
    const el = this.el;
    if (el.classList.contains('big')) {
      el.classList.remove('big');
      this.mask && this.mask.remove(); this.mask = null;
      this.app.viewsEl.append(el);
      this.applyCss();
    } else {
      const s = Math.min((window.innerHeight * 0.82) / this.h, (window.innerWidth * 0.86) / this.w);
      el.classList.add('big');
      this.canvas.style.width = this.w * s + 'px'; this.canvas.style.height = this.h * s + 'px';
      this.mask = h('div', 'view-mask'); this.mask.onclick = () => this.toggleBig();
      document.body.append(this.mask);
      document.body.append(el);
    }
  }

  dispose() { this._ro.disconnect(); this.mask && this.mask.remove(); }
}
