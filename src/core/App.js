// 实验页面外壳：布局、器材架、仪器调节面板、实验步骤引擎、数据表、一键运行、数据处理与报告
import * as THREE from 'three';
import { tex, renderMath } from './tex.js';
export { tex, renderMath };
import { Stage } from './Stage.js';
import { buildControl, h } from './Controls.js';
import { DataTable } from './DataTable.js';
import { drawPlot } from './Plot.js';
import { ObsView } from './View.js';
import { Quality } from './Quality.js';
import { GPU } from './gpu.js';
import { Coax } from './Coax.js';
import { Tutor } from './Tutor.js';

class AbortRun extends Error {}
class ReplaySkip extends Error {}

const svg = (d) => `<svg class="i" viewBox="0 0 16 16">${d}</svg>`;
export const I = {
  back: svg('<path d="M10 3 5 8l5 5"/>'),
  play: svg('<path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none"/>'),
  step: svg('<path d="M3.5 3.5v9l6-4.5z"/><path d="M12 3.5v9"/>'),
  chart: svg('<path d="M2.5 13.5h11M3.5 11l3-3.5 2.5 2 4-5"/><circle cx="6.5" cy="7.5" r=".8"/><circle cx="9" cy="9.5" r=".8"/>'),
  doc: svg('<path d="M4 2h5.5L12 4.5V14H4z"/><path d="M6 7h4M6 9.5h4M6 12h2.5"/>'),
  reset: svg('<path d="M3 8a5 5 0 1 0 1.6-3.7"/><path d="M3 2.5V5h2.5"/>'),
  cam: svg('<rect x="2" y="5" width="9" height="7" rx="1"/><path d="m11 7.5 3-1.8v5.6l-3-1.8"/>'),
  tag: svg('<path d="M2.5 2.5h5l6 6-5 5-6-6z"/><circle cx="5.3" cy="5.3" r="1"/>'),
  tutor: svg('<path d="M3 12.5V4.5a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 13 4.5v5a1.5 1.5 0 0 1-1.5 1.5H6.5L3 13.5z"/><path d="M6 6.2h4M6 8.4h2.6"/>'),
  rays: svg('<path d="M2 8h12M2 4.5 8 8l6 3.5M2 11.5 8 8l6-3.5"/>'),
};

export class App {
  constructor(root, ExpClass, { onExit }) {
    this.root = root;
    this.ExpClass = ExpClass;
    this.onExit = onExit;
    this.meta = ExpClass.meta;
    this.comps = new Map();
    this.zones = [];
    this.views = new Map();
    this.tables = [];
    this.selected = null;
    this.dirty = true;
    this.speed = 1;
    this.running = false;
    this.analysisDone = false;
    this.lastAnalysis = null;
    this.flags = {};
    this.buildDOM();
    this.stage = new Stage(this.vp);
    this.quality = new Quality(this);
    { const qs = this.page.querySelector('[data-a=quality]'); qs.value = this.quality.mode; this.onQuality = (qq) => { qs.options[0].textContent = qq.mode === 'auto' ? `画质 自动·${qq.cfg.name}` : '画质 自动'; qs.title = `画质：自动根据设备性能调节观察窗分辨率和三维像素比
干涉/衍射图样计算：${GPU.ok ? 'GPU（' + GPU.renderer + '）' : 'CPU'}`; }; this.onQuality(this.quality); }
    this.exp = new ExpClass(this);
    if (this.exp.toBench || this.exp.toWave) {
      const tb = this.page.querySelector('[data-a=tobench]');
      if (tb) {
        tb.hidden = false; tb.onclick = () => this.openInBench();
        if (this.exp.toWave) { tb.querySelector('.lb').textContent = '衍射台'; tb.title = '在新标签页的衍射工作台中打开当前装置：可改缝宽、光源宽度、谱宽和观察距离，看衍射图样如何变化'; }
      }
    }
    // 光具座实验：等高共轴调节（“自己摆”模式下元件有高度、横向和转角偏差）
    const cs = this.exp.coaxSpec && this.exp.coaxSpec();
    this.coax = cs ? new Coax(this, cs) : null;
    this.exp.build();
    this.steps = this.exp.steps();
    if (this.coax) this.steps.splice(cs.after ?? 1, 0, this.coax.step());
    this.stepIdx = 0;
    this.stepDone = this.steps.map(() => false);
    this.openStep = 0;
    for (const spec of this.exp.tables()) this.tables.push(new DataTable(spec, this));
    this.renderShelf();
    this.renderPlaceMode();
    this.tutor = new Tutor(this);
    this.tutor.mount(this.page.querySelector('[data-a=tutor]'));
    this.renderSteps();
    this.renderTables();
    this.renderInspector();
    this.leftPrinciple.innerHTML = `<div class="principle">${renderMath(this.exp.principle())}</div>`;
    this.exp.afterPrinciple && this.exp.afterPrinciple(this.leftPrinciple);
    // 点光路图放大查看
    this.leftPrinciple.onclick = (e) => {
      const f = e.target.closest('figure.diag'); if (!f) return;
      const c = f.cloneNode(true); c.style.maxWidth = '680px';
      this.modal('光路图', c.outerHTML);
    };
    this.renderCamButtons();
    this.bindPointer();
    const cams = this.exp.cameras();
    if (cams[0]) {
      this.stage.camera.position.set(...cams[0].pos);
      this.stage.controls.target.set(...cams[0].target);
    }
    this.stage.frameFns.add((dt) => this.frame(dt));
    this._checkTimer = setInterval(() => this.checkSteps(), 200);
    this.changed();
  }

  // ============================ DOM ============================
  buildDOM() {
    const m = this.meta;
    this.root.innerHTML = '';
    const page = h('div', 'exp');
    page.innerHTML = `
      <header class="topbar">
        <button class="btn" data-a="exit" title="返回实验目录">${I.back}目录</button>
        <div class="title"><b>${m.title}</b><small>${m.subtitle || ''}</small></div>
        <div class="spacer"></div>
        <span class="progress-label">进度</span><div class="progress"><div></div></div>
        <div class="tb-sep"></div>
        <div class="tb-group">
          <button class="btn primary" data-a="runall" title="从当前步骤开始自动完成全部实验">${I.play}一键运行</button>
          <button class="btn" data-a="runstep" title="自动完成当前步骤">${I.step}<span class="lb">自动完成本步</span></button>
          <button class="btn tutor-btn" data-a="tutor" title="助教：看看现在哪里不对，或者问问题">${I.tutor}<span class="lb">助教</span></button>
          <select data-a="speed" title="演示速度"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option><option value="8">8×</option></select>
          <select data-a="quality" title="画质：自动根据设备性能调节观察窗分辨率和三维像素比"><option value="auto">画质 自动</option><option value="high">画质 高</option><option value="mid">画质 中</option><option value="low">画质 低</option></select>
        </div>
        <div class="tb-sep"></div>
        <div class="tb-group">
          <button class="btn" data-a="tobench" title="在新标签页的光路设计台中打开当前光路：可自由改参数、换玻璃、看像差" hidden>${I.rays}<span class="lb">光路台</span></button>
          <button class="btn" data-a="analyze" title="数据处理">${I.chart}<span class="lb">数据处理</span></button>
          <button class="btn" data-a="report" title="实验报告">${I.doc}<span class="lb">实验报告</span></button>
          <button class="btn" data-a="reset" title="重新开始（随机生成新的待测样品参数）">${I.reset}<span class="lb">重做</span></button>
        </div>
      </header>
      <div class="main">
        <aside class="panel left">
          <div class="ptabs"><button class="on" data-lt="steps">实验步骤</button><button data-lt="principle">实验原理</button></div>
          <div class="pbody" data-lp="steps"><div class="steps"></div></div>
          <div class="pbody" data-lp="principle" style="display:none"></div>
        </aside>
        <section class="viewport">
          <div class="vtools"></div>
          <div class="views"></div>
          <div class="caption" style="opacity:0"></div>
        </section>
        <aside class="panel right">
          <div class="pbody">
            <div class="m-shelf"><div class="ph"><span>器材柜</span><small>拖到实验台，或单击放置</small></div>
            <div class="shelf"></div></div>
            <div class="m-insp"><div class="ph"><span>仪器调节</span></div>
            <div class="inspector"></div></div>
          </div>
        </aside>
      </div>
      <nav class="mtabs"><button data-mt="steps" class="on">步骤</button><button data-mt="shelf">器材</button><button data-mt="insp">调节</button><button data-mt="data">数据</button></nav>
      <section class="bottom">
        <div class="resizer"></div>
        <div class="dtabs"></div>
        <div class="dbody"><div class="dtable-wrap"></div><div class="dtable-side"></div></div>
      </section>`;
    this.root.append(page);
    this.page = page;
    const q = (s) => page.querySelector(s);
    this.vp = q('.viewport');
    this.vtools = q('.vtools');
    this.viewsEl = q('.views');
    this.captionEl = q('.caption');
    this.stepsEl = q('.steps');
    this.leftPrinciple = q('[data-lp=principle]');
    this.shelfEl = q('.shelf');
    this.inspEl = q('.inspector');
    this.dtabs = q('.dtabs');
    this.dwrap = q('.dtable-wrap');
    this.dside = q('.dtable-side');
    this.progressBar = q('.progress > div');
    this.toastsEl = document.querySelector('.toasts') || document.body.appendChild(h('div', 'toasts'));

    // 手机竖屏：三维视图在上，下方用标签切换 步骤 / 器材 / 调节 / 数据
    this.mq = window.matchMedia('(max-width: 820px)');
    page.dataset.mt = 'steps';
    page.querySelectorAll('[data-mt]').forEach((b) => b.addEventListener('click', () => this.mobileTab(b.dataset.mt)));
    page.querySelectorAll('[data-lt]').forEach((b) => b.addEventListener('click', () => {
      page.querySelectorAll('[data-lt]').forEach((x) => x.classList.toggle('on', x === b));
      page.querySelectorAll('[data-lp]').forEach((p) => (p.style.display = p.dataset.lp === b.dataset.lt ? '' : 'none'));
    }));
    q('[data-a=exit]').onclick = () => this.exit();
    q('[data-a=runall]').onclick = () => this.runAll();
    q('[data-a=runstep]').onclick = () => this.runCurrent();
    q('[data-a=speed]').onchange = (e) => (this.speed = +e.target.value);
    q('[data-a=quality]').onchange = (e) => this.quality.setMode(e.target.value);
    q('[data-a=analyze]').onclick = () => this.showAnalysis();
    q('[data-a=report]').onclick = () => this.makeReport();
    q('[data-a=reset]').onclick = () => { if (confirm('重新开始本实验？当前数据将被清除。')) this.restart(); };

    // 数据区高度拖动
    const bottom = q('.bottom');
    q('.resizer').addEventListener('pointerdown', (e) => {
      const y0 = e.clientY, h0 = bottom.offsetHeight;
      const mv = (ev) => { bottom.style.height = Math.max(38, Math.min(window.innerHeight * 0.7, h0 - (ev.clientY - y0))) + 'px'; this.stage.resize(); };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    });
    this.bottomEl = bottom;
  }

  mobileTab(t) {
    if (!this.page) return;
    this.page.dataset.mt = t;
    this.page.querySelectorAll('.mtabs [data-mt]').forEach((x) => x.classList.toggle('on', x.dataset.mt === t));
  }
  get isPhone() { return !!(this.mq && this.mq.matches); }

  renderCamButtons() {
    this.vtools.innerHTML = '';
    for (const c of this.exp.cameras()) {
      const b = h('button', 'btn small', I.cam + c.name);
      b.onclick = () => this.stage.flyTo(c.pos, c.target);
      this.vtools.append(b);
    }
    const lb = h('button', 'btn small active', I.tag + '标签');
    lb.onclick = () => {
      const on = lb.classList.toggle('active');
      this.stage.labelRenderer.domElement.style.display = on ? '' : 'none';
    };
    this.vtools.append(lb);
    for (const t of this.exp.toolButtons ? this.exp.toolButtons() : []) {
      const b = h('button', 'btn small' + (t.get && t.get() ? ' active' : ''), t.label);
      b.onclick = () => { t.onClick(); if (t.get) b.classList.toggle('active', !!t.get()); this.changed(); };
      this.vtools.append(b);
    }
  }

  /** 把实验当前的光路交给光路设计台或衍射工作台（新标签页，不打断本实验） */
  async openInBench() {
    const done = this.stepDone.every(Boolean), wave = !!this.exp.toWave;
    const scene = wave ? this.exp.toWave({ done }) : this.exp.toBench({ done });
    if (!scene || (!wave && !scene.els.length)) { this.toast(scene === false ? '完成全部步骤后才能在衍射工作台中打开（待测参数在那里是公开的）' : '先在光具座上摆好器材，再打开', 'warn'); return; }
    const { encodeScene, encodeObj } = await import('../bench/share.js');
    const url = `${location.href.split('#')[0]}#/${wave ? 'wave' : 'bench'}?s=${wave ? await encodeObj(scene) : await encodeScene(scene)}`;
    const w = window.open(url, '_blank');
    if (!w) location.hash = url.slice(url.indexOf('#')); // 弹窗被拦截时在本页打开
  }

  // ============================ 视图窗口 ============================
  /** 添加一个观察窗口（画布）：可改变大小、放大平移，分辨率随显示尺寸自适应。返回 {canvas, ctx, W, H, foot(text), show(bool)} */
  addView(opts) {
    const v = new ObsView(this, opts);
    this.views.set(opts.id, v);
    return v;
  }

  // ============================ 区域与器材 ============================
  addRail({ id = 'rail', origin, dir = new THREE.Vector3(1, 0, 0), min = 0, max = 100, accepts = null }) {
    this.zones.push({ type: 'rail', id, origin, dir: dir.clone().normalize(), min, max, accepts });
  }
  addSlot({ id, pos, rotY = 0, accepts = null, label = '' }) {
    const marker = new THREE.Mesh(new THREE.RingGeometry(5, 6.2, 40), new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false }));
    marker.rotation.x = -Math.PI / 2;
    marker.position.copy(pos).add(new THREE.Vector3(0, 0.15, 0));
    this.stage.scene.add(marker);
    this.zones.push({ type: 'slot', id, pos, rotY, accepts, label, marker, occupant: null });
  }

  /** 光学平台：在“自己摆”模式下，插槽类仪器可以放在台面任意位置、任意角度 */
  addTable({ id = 'table', x0, x1, z0, z1, y = 0 }) {
    this.zones.push({ type: 'table', id, x0, x1, z0, z1, y });
    this.hasTable = true;
    this.renderPlaceMode && this.renderPlaceMode();
  }
  get placeFree() { if (!this.hasTable && !this.coax) return false; try { return localStorage.getItem('place:' + this.meta.id) !== 'auto'; } catch { return true; } }
  set placeFree(v) { try { localStorage.setItem('place:' + this.meta.id, v ? 'free' : 'auto'); } catch { /* 无痕模式等 */ } }
  isFree(c) { return !!(c && this.placeFree && c.zone === 'slot' && !c.noFree && !c.fixed); }
  get tableZone() { return this.zones.find((z) => z.type === 'table'); }
  slotPose(c, slotId) {
    const z = this.zones.find((z) => z.type === 'slot' && z.id === (slotId ?? c.defaultSlot));
    return z ? { x: z.pos.x, z: z.pos.z, rot: (z.rotY * 180) / Math.PI } : { x: 0, z: 0, rot: 0 };
  }
  /** 设置自由摆放仪器的底座位置（cm）与转角（°） */
  setPose(c, x, z, rot = c.rot ?? 0) {
    const t = this.tableZone;
    if (t) { x = Math.min(t.x1, Math.max(t.x0, x)); z = Math.min(t.z1, Math.max(t.z0, z)); }
    rot = ((((rot + 180) % 360) + 360) % 360) - 180;
    c.tx = x; c.tz = z; c.rot = rot;
    c.root.position.set(x, t ? t.y : 0, z);
    c.root.rotation.y = (rot * Math.PI) / 180;
    if (this.selected === c) this.updateRing();
    this.changed();
  }
  /** 自由摆放的仪器是否已在标准位置（容差：位置 cm、角度 °） */
  atSlot(key, tolPos = 0.05, tolRot = 0.05) {
    const c = this.comp(key); if (!c || !c.placed) return false;
    if (!this.isFree(c)) return true;
    const p = this.slotPose(c);
    return Math.hypot(c.tx - p.x, c.tz - p.z) <= tolPos && Math.abs(((((c.rot - p.rot + 180) % 360) + 360) % 360) - 180) <= tolRot;
  }
  /** 自动演示：把自由摆放的仪器移到标准位置 */
  async alignTo(key, ms = 900) {
    const c = this.comp(key);
    if (!this.isFree(c) || !c.placed) return;
    const p = this.slotPose(c), x0 = c.tx, z0 = c.tz, r0 = c.rot;
    const dr = ((((p.rot - r0 + 180) % 360) + 360) % 360) - 180;
    this.select(c);
    await this.tween(() => 0, (k) => this.setPose(c, x0 + (p.x - x0) * k, z0 + (p.z - z0) * k, r0 + dr * k), 1, ms);
    this.setPose(c, p.x, p.z, p.rot);
  }
  setPlaceFree(v) {
    if (v === this.placeFree) return;
    this.placeFree = v;
    for (const c of this.placedComps()) {
      if (this.coax && this.coax.has(c)) { if (!v) { this.coax.zero(c); this.coax.pose(c); } continue; }
      if (c.zone !== 'slot' || c.noFree || c.fixed) continue;
      if (v) { const z = this.zones.find((z) => z.id === c.slot); if (z) z.occupant = null; c.slot = null; const p = c.root.position; this.setPose(c, p.x, p.z, (c.root.rotation.y * 180) / Math.PI); }
      else { const z = this.zones.find((z) => z.type === 'slot' && z.id === c.defaultSlot); if (z && !z.occupant) { z.occupant = c; c.slot = z.id; c.root.position.copy(z.pos); c.root.rotation.y = z.rotY; } else this.remove(c); }
    }
    this.renderPlaceMode(); this.renderInspector(); this.updateRing(); this.changed();
    this.toast(this.coax ? (v ? '自己摆：放到导轨上的元件有高度、横向和转角偏差，需要自己调等高共轴' : '自动对准：元件光心自动处在光轴上')
      : v ? '自己摆：仪器可以放在台面任意位置、任意角度，光路要自己调' : '自动对准：仪器放在标准位置', 'ok');
  }
  /** 器材柜标题处的摆放方式开关 */
  renderPlaceMode() {
    const ph = this.page && this.page.querySelector('.m-shelf .ph');
    if (!ph) return;
    let el = ph.querySelector('.pmode');
    if (!this.hasTable && !this.coax) { if (el) el.remove(); return; }
    if (!el) {
      el = h('div', 'pmode');
      el.innerHTML = this.coax
        ? '<button data-pm="free" title="放到导轨上的元件有高度、横向和转角偏差，需要自己调等高共轴">自己摆</button><button data-pm="auto" title="元件光心自动处在光轴上">自动对准</button>'
        : '<button data-pm="free" title="仪器放在台面任意位置和角度，需要自己调光路">自己摆</button><button data-pm="auto" title="仪器自动放在标准位置">自动对准</button>';
      el.querySelectorAll('button').forEach((b) => (b.onclick = () => { if (!this.running) this.setPlaceFree(b.dataset.pm === 'free'); }));
      ph.querySelector('small') && ph.querySelector('small').remove();
      ph.append(el);
    }
    el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b.dataset.pm === 'free') === this.placeFree));
  }

  addComponent(comp) {
    this.comps.set(comp.key, comp);
    if (comp.fixed) this.place(comp, { pos: comp.defaultPos, slot: comp.defaultSlot, silent: true });
    return comp;
  }
  comp(key) { return this.comps.get(key); }
  /** 等高共轴：到达元件 key 的相对光强（无此调节、或元件未放置时为 1） */
  coaxT(key) { const c = this.comps.get(key); return this.coax && c && c.placed && this.coax.has(c) ? this.coax.T(key) : 1; }
  /** 等高共轴：导轨坐标 x 处实际光束中心的三维位置（光轴高 y0、横向 z0 为理想位置） */
  coaxV(x, y0, z0 = 0) { const o = this.coax ? this.coax.at(x) : { y: 0, z: 0 }; return new THREE.Vector3(x, y0 + o.y, z0 + o.z); }
  /** 等高共轴：光斑中心相对元件 key 中心的偏离 { y, z }，cm */
  coaxOff(key) { const c = this.comps.get(key); return this.coax && c && c.placed && this.coax.has(c) ? this.coax.off(key) : { y: 0, z: 0 }; }
  placedComps() { return [...this.comps.values()].filter((c) => c.placed); }

  zoneFor(comp) {
    return this.zones.filter((z) => (z.type === 'rail' ? comp.zone === 'rail' : comp.zone === 'slot') && (!z.accepts || z.accepts.includes(comp.key)));
  }

  setRailPos(comp, x) {
    const z = this.zones.find((z) => z.type === 'rail' && z.id === (comp.rail || 'rail'));
    if (!z) return;
    comp.pos = Math.min(z.max, Math.max(z.min, x));
    comp.root.position.copy(z.origin).addScaledVector(z.dir, comp.pos);
    if (this.coax && comp.placed) this.coax.pose(comp);
    this.changed();
  }

  place(comp, opts = {}) {
    if (!comp.placed && !this.running) this.tutor && this.tutor.event(`把「${comp.name}」放上实验台`);
    let { pos, slot, silent } = opts;
    if ((opts.table || opts.exact) && comp.zone !== 'rail' && comp.zone !== 'none') pos = { table: opts.table, exact: opts.exact };
    if (comp.placed) return true;
    if (!silent && this.exp.canPlace) {
      const err = this.exp.canPlace(comp, { pos, slot });
      if (err) { this.toast(err, 'warn'); return false; }
    }
    if (comp.zone === 'none') {
      this.stage.scene.add(comp.root);
      comp.placed = true;
    } else if (comp.zone === 'rail') {
      this.stage.scene.add(comp.root);
      comp.placed = true;
      this.setRailPos(comp, pos ?? comp.defaultPos ?? 50);
      if (this.coax && this.coax.has(comp)) { if (this.coax.on && !opts.exact) this.coax.randomize(comp); else this.coax.zero(comp); this.coax.pose(comp); }
    } else if (this.isFree(comp)) {
      let p = pos && pos.table ? pos.table : null;
      if (!p) {
        p = this.slotPose(comp, slot);
        // 单击放置：大致放在该放的地方，位置和方向留有偏差，需要自己调
        if (!pos || !pos.exact) { const r = (a, b) => (Math.random() < 0.5 ? -1 : 1) * (a + Math.random() * (b - a)); p = { x: p.x + r(1, 3), z: p.z + r(1, 3), rot: p.rot + r(2, 6) }; }
      }
      comp.slot = null;
      this.stage.scene.add(comp.root);
      comp.placed = true;
      this.setPose(comp, p.x, p.z, p.rot);
    } else if (comp.zone === 'slot') {
      const zs = this.zoneFor(comp);
      const z = zs.find((z) => z.id === (slot ?? comp.defaultSlot)) || zs.find((z) => !z.occupant);
      if (!z) { this.toast('没有可放置的位置', 'warn'); return false; }
      if (z.occupant && z.occupant !== comp) { this.toast(`该位置已放置「${z.occupant.name}」`, 'warn'); return false; }
      z.occupant = comp; comp.slot = z.id;
      comp.root.position.copy(z.pos);
      comp.root.rotation.y = z.rotY;
      this.stage.scene.add(comp.root);
      comp.placed = true;
    }
    if (!comp.labelObj) {
      comp.labelObj = this.stage.makeLabel('');
      comp.labelObj.position.set(0, comp.labelY ?? 34, 0);
      comp.root.add(comp.labelObj);
    }
    comp.labelObj.visible = comp.showLabel !== false;
    this.exp.onPlace && this.exp.onPlace(comp);
    if (!silent) this.toast(`已放置：${comp.name}`, 'ok');
    this.renderShelf();
    this.changed();
    return true;
  }

  remove(comp) {
    if (!comp.placed || comp.fixed) return;
    if (!this.running) this.tutor && this.tutor.event(`把「${comp.name}」取下放回器材柜`);
    if (comp.slot) { const z = this.zones.find((z) => z.id === comp.slot); if (z) z.occupant = null; comp.slot = null; }
    this.stage.scene.remove(comp.root);
    if (comp.labelObj) comp.labelObj.element.remove(); // CSS2DRenderer 不会清理已脱离场景的标签
    comp.placed = false;
    comp.setHighlight(false);
    if (this.selected === comp) this.select(null);
    this.exp.onRemove && this.exp.onRemove(comp);
    this.renderShelf();
    this.changed();
  }

  renderShelf() {
    const items = [...this.comps.values()].filter((c) => !c.fixed);
    this.shelfEl.innerHTML = '';
    if (!items.length) { this.shelfEl.innerHTML = '<div class="empty-tip" style="grid-column:1/3">本实验主要仪器已就位。</div>'; return; }
    for (const c of items) {
      const it = h('div', 'shelf-item' + (c.placed ? ' placed' : '') + (c.required && !c.placed ? ' req' : ''));
      it.innerHTML = `<div class="ic">${c.icon || ''}</div><div class="nm">${c.name}</div>`;
      it.title = c.desc || c.name;
      if (!c.placed) {
        // 触屏上拖拽和滚动器材柜冲突：轻点即放到默认位置，再到场景里拖动
        it.addEventListener('pointerdown', (e) => { this._lastPointer = e.pointerType; if (e.pointerType !== 'touch') this.beginShelfDrag(e, c); });
        it.addEventListener('click', (e) => { if (this._lastPointer === 'touch' && !this.running && this.place(c)) this.select(c); });
      } else it.addEventListener('click', () => this.select(c));
      this.shelfEl.append(it);
    }
  }

  // ============================ 选择与调节面板 ============================
  select(comp) {
    if (this.selected && this.selected !== comp) this.selected.setHighlight(false);
    this.selected = comp;
    if (comp) comp.setHighlight(true);
    this.updateRing();
    if (comp && this.isPhone && !this.running && this.page.dataset.mt !== 'insp') this.mobileTab('insp');
    this.renderInspector();
    this.changed();
  }

  renderInspector() {
    this.inspEl.innerHTML = '';
    this.ctlRefreshers = [];
    const c = this.selected;
    const global = this.exp.globalControls ? this.exp.globalControls() : [];
    if (!c) {
      this.inspEl.append(h('div', 'empty-tip', '在三维场景中<b>单击</b>某个仪器即可在此处调节它；导轨上的器材可直接<b>拖动</b>改变位置。<br>鼠标左键旋转视角、右键平移、滚轮缩放。'));
    } else {
      const t = h('div', 'insp-title', `<b>${c.name}</b>`);
      if (!c.fixed) {
        const rb = h('button', 'btn small', '放回器材架');
        rb.onclick = () => this.remove(c);
        t.append(rb);
      }
      this.inspEl.append(t);
      if (c.desc) this.inspEl.append(h('div', 'insp-desc', c.desc));
      const descs = [];
      if (c.zone === 'rail' && c.movable) {
        descs.push({
          type: 'knob', label: '导轨位置（滑座刻线）', get: () => c.pos, set: (v) => this.setRailPos(c, v),
          step: 0.05, bigStep: 1, perRev: 2, digits: 2, unit: 'cm', sub: '可直接在场景中拖动；旋钮/按钮用于精细移动',
        });
      }
      if (this.coax && !this.running) descs.push(...this.coax.controls(c));
      if (this.isFree(c) && !this.running) {
        descs.push(
          { type: 'knob', label: '底座 左右（x）', get: () => c.tx, set: (v) => this.setPose(c, v, c.tz), step: 0.05, bigStep: 1, perRev: 2, digits: 2, unit: 'cm', sub: '在场景中拖动底座可快速移动；拖动底座外的蓝色圆环（或按住 Shift 拖动）可转动' },
          { type: 'knob', label: '底座 前后（z）', get: () => c.tz, set: (v) => this.setPose(c, c.tx, v), step: 0.05, bigStep: 1, perRev: 2, digits: 2, unit: 'cm' },
          { type: 'knob', label: '底座转角', get: () => c.rot, set: (v) => this.setPose(c, c.tx, c.tz, v), step: 0.05, bigStep: 2, perRev: 10, digits: 2, unit: '°', wrap: true },
        );
      }
      descs.push(...(c.controls ? c.controls() : []));
      this.tutor && this.tutor.seed(c, descs);
      for (const d of descs) {
        const w = buildControl(d, () => { this.changed(); this.tutor && this.tutor.track(c, d); });
        this.inspEl.append(w.el); this.ctlRefreshers.push(w.refresh);
      }
    }
    if (global.length) {
      this.tutor && this.tutor.seed('global', global);
      this.inspEl.append(h('div', 'ph', '<span>测量与读数</span>'));
      for (const d of global) {
        const w = buildControl(d, () => { this.changed(); this.tutor && this.tutor.track('global', d); });
        this.inspEl.append(w.el); this.ctlRefreshers.push(w.refresh);
      }
    }
  }

  // ============================ 交互 ============================
  bindPointer() {
    const dom = this.stage.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => this.onDown(e));
    this._mv = (e) => this.onMove(e);
    this._up = (e) => this.onUp(e);
    window.addEventListener('pointermove', this._mv);
    window.addEventListener('pointerup', this._up);
  }

  pickComp(e) {
    const roots = this.placedComps().map((c) => c.root);
    const hit = this.stage.pickObjects(e, roots);
    if (!hit) return null;
    let o = hit.object;
    while (o && !o.userData.component) o = o.parent;
    return o ? o.userData.component : null;
  }

  onDown(e) {
    if (e.button !== 0) return;
    // 实验可接管点击（如电学实验中点接线柱连线）
    if (this.exp.pointerDown && !this.running && this.exp.pointerDown(e)) { this._clickEmpty = false; return; }
    this._downXY = [e.clientX, e.clientY];
    // 转动圆环
    if (this.ring && this.ring.visible && !this.running && this.stage.pickObjects(e, [this.ring])) {
      const c = this.selected, t = this.tableZone, p = this.stage.hitPlane(e, t.y);
      if (p) { this.drag = { comp: c, rotate: true, a0: Math.atan2(-(p.z - c.tz), p.x - c.tx), r0: c.rot }; this.stage.controls.enabled = false; this._clickEmpty = false; return; }
    }
    const c = this.pickComp(e);
    if (!c) { this._clickEmpty = true; return; }
    this._clickEmpty = false;
    this.select(c);
    if (this.isFree(c) && !this.running) {
      const t = this.tableZone, p = this.stage.hitPlane(e, t.y);
      if (p) {
        this.drag = e.shiftKey ? { comp: c, rotate: true, a0: Math.atan2(-(p.z - c.tz), p.x - c.tx), r0: c.rot } : { comp: c, free: true, off: [p.x - c.tx, p.z - c.tz] };
        this.stage.controls.enabled = false;
      }
      return;
    }
    if (c.zone === 'rail' && c.movable && !this.running) {
      const z = this.zones.find((z) => z.type === 'rail' && z.id === (c.rail || 'rail'));
      const p = this.stage.hitPlane(e, z.origin.y);
      if (p) {
        const t = p.clone().sub(z.origin).dot(z.dir);
        this.drag = { comp: c, zone: z, off: t - c.pos };
        this.stage.controls.enabled = false;
      }
    }
  }

  onMove(e) {
    if (this.drag && this.drag.fromShelf) return this.moveShelfDrag(e);
    if (this.drag && (this.drag.free || this.drag.rotate)) {
      const d = this.drag, c = d.comp, t = this.tableZone, p = this.stage.hitPlane(e, t.y);
      if (!p) return;
      if (d.free) this.setPose(c, Math.round((p.x - d.off[0]) * 10) / 10, Math.round((p.z - d.off[1]) * 10) / 10);
      else { const a = Math.atan2(-(p.z - c.tz), p.x - c.tx); this.setPose(c, c.tx, c.tz, Math.round((d.r0 + ((a - d.a0) * 180) / Math.PI) * 10) / 10); }
      return;
    }
    if (this.drag) {
      const { comp, zone, off } = this.drag;
      const p = this.stage.hitPlane(e, zone.origin.y);
      if (p) {
        const t = p.clone().sub(zone.origin).dot(zone.dir) - off;
        this.setRailPos(comp, Math.round(t * 20) / 20);
      }
      return;
    }
    if (e.target !== this.stage.renderer.domElement) return;
    if (this.exp.pointerMove && this.exp.pointerMove(e)) {
      if (this._hover && this._hover !== this.selected) this._hover.setHighlight(false);
      this._hover = null;
      return;
    }
    const c = this.pickComp(e);
    if (this._hover !== c) {
      if (this._hover && this._hover !== this.selected) this._hover.setHighlight(false);
      this._hover = c;
      if (c) c.setHighlight(true);
      this.stage.renderer.domElement.style.cursor = c ? ((c.zone === 'rail' && c.movable) || this.isFree(c) ? 'grab' : 'pointer') : '';
    }
  }

  onUp(e) {
    if (this.drag && this.drag.fromShelf) return this.endShelfDrag(e);
    if (this.drag) { this.drag = null; this.stage.controls.enabled = true; return; }
    if (this._clickEmpty && this._downXY && e.target === this.stage.renderer.domElement) {
      const d = Math.hypot(e.clientX - this._downXY[0], e.clientY - this._downXY[1]);
      if (d < 4) this.select(null);
    }
    this._clickEmpty = false;
  }

  beginShelfDrag(e, comp) {
    if (this.running) return;
    e.preventDefault();
    this.drag = { fromShelf: true, comp, sx: e.clientX, sy: e.clientY, moved: false, target: null };
    this.zones.forEach((z) => { if (z.marker && this.zoneFor(comp).includes(z)) z.marker.material.opacity = z.occupant ? 0.15 : 0.6; });
  }
  moveShelfDrag(e) {
    const d = this.drag;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6) d.moved = true;
    if (!d.moved) return;
    const comp = d.comp;
    d.target = null;
    const zs = this.zoneFor(comp);
    if (this.isFree(comp)) {
      const t = this.tableZone, p = this.stage.hitPlane(e, t.y);
      if (p && p.x > t.x0 && p.x < t.x1 && p.z > t.z0 && p.z < t.z1) {
        if (d.rot == null) d.rot = this.slotPose(comp).rot + (Math.random() - 0.5) * 16;
        d.target = { table: { x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, rot: d.rot } };
        if (!comp.root.parent) this.stage.scene.add(comp.root);
        comp.root.position.set(d.target.table.x, t.y, d.target.table.z); comp.root.rotation.y = (d.rot * Math.PI) / 180;
      } else if (comp.root.parent && !comp.placed) this.stage.scene.remove(comp.root);
      return;
    }
    for (const z of zs) {
      if (z.type === 'rail') {
        const p = this.stage.hitPlane(e, z.origin.y);
        if (!p) continue;
        const rel = p.clone().sub(z.origin);
        const t = rel.dot(z.dir);
        const perp = rel.clone().addScaledVector(z.dir, -t).length();
        if (perp < 40 && t > z.min - 20 && t < z.max + 20) { d.target = { pos: Math.min(z.max, Math.max(z.min, Math.round(t * 10) / 10)) }; break; }
      } else {
        const p = this.stage.hitPlane(e, z.pos.y);
        if (p && p.distanceTo(z.pos) < 35 && !z.occupant) {
          if (!d.target || p.distanceTo(z.pos) < d.target.dist) d.target = { slot: z.id, dist: p.distanceTo(z.pos), z };
        }
      }
    }
    if (d.target) {
      if (!comp.root.parent) this.stage.scene.add(comp.root);
      if (d.target.pos != null) {
        const z = zs.find((z) => z.type === 'rail');
        comp.root.position.copy(z.origin).addScaledVector(z.dir, d.target.pos);
      } else { comp.root.position.copy(d.target.z.pos); comp.root.rotation.y = d.target.z.rotY; }
    } else if (comp.root.parent && !comp.placed) {
      this.stage.scene.remove(comp.root);
    }
  }
  endShelfDrag() {
    const d = this.drag; this.drag = null;
    this.zones.forEach((z) => z.marker && (z.marker.material.opacity = 0));
    const comp = d.comp;
    if (!comp.placed && comp.root.parent) this.stage.scene.remove(comp.root);
    if (!d.moved) { if (this.place(comp)) this.select(comp); return; }
    if (d.target) { if (this.place(comp, d.target)) this.select(comp); }
  }

  /** 选中自由摆放的仪器时，在底座周围显示转动圆环 */
  updateRing() {
    const c = this.selected;
    const show = !!(c && c.placed && this.isFree(c) && !this.running);
    if (!this.ring) {
      if (!show) return;
      const g = new THREE.TorusGeometry(1, 0.05, 8, 72); g.rotateX(Math.PI / 2);
      this.ring = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.8, depthWrite: false }));
      const tick = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 8), this.ring.material); tick.rotation.z = -Math.PI / 2; tick.position.set(1.1, 0, 0); this.ring.add(tick);
      this.ring.renderOrder = 8; this.stage.scene.add(this.ring);
    }
    this.ring.visible = show;
    if (show) {
      const R = c.ringR ?? 6;
      this.ring.scale.set(R, R, R);
      this.ring.position.set(c.tx, (this.tableZone.y || 0) + 0.3, c.tz);
      this.ring.rotation.y = (c.rot * Math.PI) / 180;
    }
    this.stage.invalidate();
  }

  // ============================ 主循环 ============================
  changed() { this.dirty = true; this.stage && this.stage.invalidate(); }

  frame(dt) {
    if (this.exp.tick) this.exp.tick(dt);
    if (this.dirty) {
      this.dirty = false;
      for (const v of this.views.values()) v.base();
      const t0 = performance.now();
      this.exp.update();
      this.quality.sample(performance.now() - t0);
      for (const r of this.ctlRefreshers || []) r();
      for (const c of this.placedComps()) {
        if (!c.labelObj) continue;
        const txt = c.labelText ? c.labelText() : (c.zone === 'rail' ? `${c.name}<br><small>${c.pos.toFixed(2)} cm</small>` : c.name);
        if (c._lt !== txt) { c.labelObj.element.innerHTML = txt; c._lt = txt; }
        c.labelObj.element.classList.toggle('sel', c === this.selected);
      }
    }
  }

  // ============================ 步骤引擎 ============================
  renderSteps() {
    this.stepsEl.innerHTML = '';
    this.stepEls = this.steps.map((s, i) => {
      const el = h('div', 'step');
      el.innerHTML = `<div class="sh"><div class="num">${i + 1}</div><div class="st">${s.title}</div></div>
        <div class="sb">${renderMath(s.html || '')}<div class="status"></div><div class="hint">${renderMath(s.hint || '本步没有额外提示。')}</div>
        <div class="acts"><button class="btn small" data-h>提示</button><button class="btn small" data-auto>${I.step}自动完成</button>${s.manual ? '<button class="btn small ok" data-ok>完成此步</button>' : ''}${s.optional ? '<button class="btn small" data-skip>跳过</button>' : ''}</div></div>`;
      el.querySelector('.sh').onclick = () => { this.openStep = this.openStep === i ? -1 : i; this.updateStepUI(); };
      el.querySelector('[data-h]').onclick = () => el.querySelector('.hint').classList.toggle('show');
      el.querySelector('[data-auto]').onclick = () => this.runStep(i);
      const okb = el.querySelector('[data-ok]');
      if (okb) okb.onclick = () => { if (i === this.stepIdx) this.completeStep(i); };
      const sk = el.querySelector('[data-skip]');
      if (sk) sk.onclick = () => { if (i === this.stepIdx) this.completeStep(i, true); };
      this.stepsEl.append(el);
      return el;
    });
    this.updateStepUI();
  }

  updateStepUI() {
    this.stepEls.forEach((el, i) => {
      el.classList.toggle('done', this.stepDone[i]);
      el.classList.toggle('cur', i === this.stepIdx);
      el.classList.toggle('open', i === this.openStep);
      const s = this.steps[i];
      const st = el.querySelector('.status');
      st.innerHTML = s.status && i === this.stepIdx ? this.studentView(() => s.status()) : '';
    });
    const n = this.stepDone.filter(Boolean).length;
    this.progressBar.style.width = (100 * n) / this.steps.length + '%';
  }

  checkSteps() {
    this.tutor && this.tutor.tick();
    if (this.stepIdx >= this.steps.length) return;
    const s = this.steps[this.stepIdx];
    let ok = false;
    try { ok = s.check ? !!this.studentView(() => s.check()) : false; } catch (err) { console.warn(err); }
    if (ok) this.completeStep(this.stepIdx);
    else if (s.status) {
      const st = this.stepEls[this.stepIdx].querySelector('.status');
      const html = this.studentView(() => s.status());
      if (st.innerHTML !== html) st.innerHTML = html;
    }
  }

  completeStep(i, skipped = false) {
    if (this.stepDone[i]) return;
    this.stepDone[i] = true;
    this.tutor && this.tutor.event(`${skipped ? '跳过' : this.running ? '自动完成' : '完成'}第 ${i + 1} 步「${this.steps[i].title}」`);
    if (!skipped) this.toast(`完成：${this.steps[i].title}`, 'ok');
    if (i === this.stepIdx) {
      while (this.stepIdx < this.steps.length && this.stepDone[this.stepIdx]) this.stepIdx++;
      this.openStep = this.stepIdx;
      if (this.stepIdx >= this.steps.length && !this.running) this.toast('全部实验步骤已完成，可以生成实验报告。', 'ok');
    }
    this.updateStepUI();
    const el = this.stepEls[this.openStep];
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ============================ 一键运行 ============================
  async runStep(i) {
    if (this.running) return;
    if (i !== this.stepIdx) { this.toast('请先完成前面的步骤（或使用「一键运行」）', 'warn'); return; }
    await this._run([i]);
  }
  runCurrent() { return this.runStep(this.stepIdx); }
  async runAll() {
    if (this.running) return;
    const idx = [];
    for (let i = this.stepIdx; i < this.steps.length; i++) idx.push(i);
    if (!idx.length) { this.toast('全部步骤均已完成', 'ok'); return; }
    await this._run(idx);
  }
  async _run(list) {
    this.running = true;
    this._abort = false;
    this.updateRing();
    const bar = h('div', 'autobar', '<span class="dot"></span><span>自动演示中</span>');
    const stop = h('button', 'btn small danger', '停止');
    stop.onclick = () => { this._abort = true; };
    bar.append(stop);
    this.vp.append(bar);
    try {
      for (const i of list) {
        if (this.stepDone[i]) continue;
        this.openStep = i; this.updateStepUI();
        const s = this.steps[i];
        this.say(`第 ${i + 1} 步：${s.title}`);
        await this.wait(500);
        if (s.auto) await s.auto();
        // 等待检查通过；不通过（多半是前面的设置被学生改动过）就先恢复前面的设置再试一次
        let ok = await this.waitCheck(s, 6000);
        if (!ok) ok = await this.recover(i);
        if (!ok) { this.toast(`第 ${i + 1} 步未能自动完成，打开助教看看哪里不对`, 'warn'); this.tutor && this.tutor.onAutoFail(); break; }
        this.completeStep(i);
        await this.wait(400);
      }
      if (this.stepIdx >= this.steps.length) this.say('实验完成！可点击「实验报告」导出。', 3000);
    } catch (err) {
      if (!(err instanceof AbortRun)) { console.error(err); this.toast('自动运行出错：' + err.message, 'bad'); }
      else this.toast('已停止自动演示', 'warn');
    } finally {
      this.running = false;
      bar.remove();
      this.updateRing(); this.renderInspector();
      setTimeout(() => this.say(''), 1500);
    }
  }

  /** 等待条件成立（实时最多 ms 毫秒），超时返回 false；自动操作里的等待都应该有上限，避免卡死 */
  async until(cond, ms = 90000) {
    const t0 = performance.now();
    while (!cond()) { if (performance.now() - t0 > ms) return false; await this.wait(60, true); this.checkAbort(); }
    return true;
  }
  async waitCheck(s, ms) {
    let t = 0;
    while (s.check && !s.check() && t < ms) { await this.wait(100, true); t += 100; }
    return !s.check || !!s.check();
  }
  /**
   * 自动完成某步失败后的恢复：重放前面各步的自动操作，把被改乱的仪器设置恢复（只重放“调节类”操作：
   * 一旦某步要记录数据或做数据处理就跳过该步；数据表最后恢复原样），然后重做本步。
   * 实验也可以给步骤写 recover() 自己处理。
   */
  async recover(i) {
    const s = this.steps[i];
    this.say(`第 ${i + 1} 步没对上：先把前面的设置恢复，再试一次`);
    const saved = this.tables.map((t) => JSON.stringify(t.rows)), ana = this.analysisDone;
    try {
      if (s.recover) await s.recover();
      else for (let j = 0; j < i; j++) {
        const sj = this.steps[j];
        if (!sj.auto || sj.noReplay) continue;
        this._replay = true; this._replaySkip = false;
        const timer = setTimeout(() => (this._replaySkip = true), 25000);
        try { await sj.auto(); } catch (err) { if (!(err instanceof ReplaySkip)) throw err; } finally { clearTimeout(timer); this._replay = false; this._replaySkip = false; }
      }
    } finally {
      this._replay = false;
      this.tables.forEach((t, k) => { const r = saved[k]; if (JSON.stringify(t.rows) !== r) { t.rows = JSON.parse(r); t.changed(); } });
      this.analysisDone = ana;
    }
    this.say(`第 ${i + 1} 步：${s.title}`);
    if (s.auto) await s.auto();
    return this.waitCheck(s, 6000);
  }
  checkAbort() { if (this._abort) throw new AbortRun(); if (this._replaySkip) throw new ReplaySkip(); }
  wait(ms, raw = false) {
    return new Promise((res, rej) => setTimeout(() => (this._abort && this.running ? rej(new AbortRun()) : this._replaySkip ? rej(new ReplaySkip()) : res()), raw ? ms : ms / this.speed));
  }
  /** 动画地把数值从当前值调到目标值 */
  async tween(get, set, to, ms = 800) {
    this.checkAbort();
    const from = get();
    const dur = ms / this.speed;
    const t0 = performance.now();
    await new Promise((res, rej) => {
      const step = () => {
        if (this._abort) return rej(new AbortRun());
        if (this._replaySkip) return rej(new ReplaySkip());
        const k = Math.min(1, (performance.now() - t0) / dur);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        set(from + (to - from) * e);
        this.changed();
        if (k < 1) requestAnimationFrame(step); else res();
      };
      step();
    });
  }
  /** 自动放置器材（带飞入动画） */
  async autoPlace(key, where = {}) {
    this.checkAbort();
    const c = this.comp(key);
    if (c.placed) { if (this.isFree(c) && !this.atSlot(key)) await this.alignTo(key); return; }
    this.select(null);
    if (!this.place(c, { ...where, exact: true })) return;
    const p1 = c.root.position.clone();
    const p0 = p1.clone().add(new THREE.Vector3(0, 40, 30));
    await this.tween(() => 0, (k) => {
      c.root.position.lerpVectors(p0, p1, k);
    }, 1, 700);
    c.root.position.copy(p1);
    this.select(c);
    await this.wait(200);
  }
  async moveTo(key, x, ms = 900) {
    const c = this.comp(key);
    this.select(c);
    await this.tween(() => c.pos, (v) => this.setRailPos(c, v), x, ms);
  }
  async setVal(get, set, to, ms = 700) { return this.tween(get, set, to, ms); }
  say(text, hold = 0) {
    this.captionEl.textContent = text;
    this.captionEl.style.opacity = text ? 1 : 0;
    clearTimeout(this._sayT);
    if (text && (hold || !this.running)) this._sayT = setTimeout(() => (this.captionEl.style.opacity = 0), hold || 3500);
  }
  async view(name) {
    const c = this.exp.cameras().find((c) => c.name === name);
    if (c) await this.stage.flyTo(c.pos, c.target, 900 / Math.min(this.speed, 2));
  }

  // ============================ 数据表 ============================
  renderTables() {
    this.dtabs.innerHTML = '';
    const coll = h('button', 'btn small ghost', '▾');
    coll.title = '收起/展开数据区';
    coll.onclick = () => { this.bottomEl.classList.toggle('collapsed'); coll.textContent = this.bottomEl.classList.contains('collapsed') ? '▴' : '▾'; setTimeout(() => this.stage.resize(), 50); };
    this.dtabs.append(h('span', 'dt-title', '数据记录'));
    this.tables.forEach((t, i) => {
      const b = h('button', 't' + (i === 0 ? ' on' : ''), t.spec.title);
      b.onclick = () => this.showTable(i);
      this.dtabs.append(b);
      t._tab = b;
    });
    this.dtabs.append(h('span', 'sp'));
    const rs = h('button', 'btn small' + (this.readSelf ? ' active' : ''), '自己读数');
    rs.title = '开：点“记录”后表格留空，由你读仪器、填写读数，程序核对是否读对；关：由仪器自动填入读数';
    rs.onclick = () => { this.readSelf = !this.readSelf; rs.classList.toggle('active', this.readSelf); this.toast(this.readSelf ? '自己读数：记录后请在表格中填写读数' : '自动读数：记录时由仪器直接填入', 'ok'); };
    this.dtabs.append(rs);
    const ab = h('button', 'btn small ink', I.chart + '数据处理');
    ab.onclick = () => this.showAnalysis();
    this.dtabs.append(ab, coll);
    if (this.tables.length) this.showTable(0);
  }
  showTable(i) {
    this.curTable = this.tables[i];
    this.tables.forEach((t, j) => t._tab.classList.toggle('on', i === j));
    const t = this.curTable;
    t.mount(this.dwrap);
    this.dside.innerHTML = '';
    for (const b of t.spec.buttons || []) {
      const btn = h('button', 'btn ' + (b.primary !== false ? 'primary' : ''), b.label);
      btn.onclick = () => {
        this.tutor && this.tutor.event(`点了「${t.spec.title}」的「${b.label}」`);
        t.selfRead = this.readSelf && !this.running; t.pended = 0;
        try { b.onClick(t); } finally { t.selfRead = false; }
        if (t.pended && (this._readHint = (this._readHint || 0) + 1) <= 3) this.toast('已记下这一组。请读仪器，把读数填进表格中高亮的空格', 'ok');
      };
      this.dside.append(btn);
    }
    const clr = h('button', 'btn small', '清空本表');
    clr.onclick = () => { if (confirm('清空本表全部数据？')) t.clear(); };
    this.dside.append(clr);
    if (t.spec.note) this.dside.append(h('div', 'note', renderMath(t.spec.note)));
  }
  table(id) { return this.tables.find((t) => t.id === id); }
  get readSelf() { try { return localStorage.getItem('readSelf') !== '0'; } catch { return true; } }
  set readSelf(v) { try { localStorage.setItem('readSelf', v ? '1' : '0'); } catch { /* 无痕模式等 */ } }
  /** 在“学生视角”下执行：尚未由学生填写的读数一律视为空（用于步骤判断与数据处理） */
  studentView(fn) {
    const st = [];
    for (const t of this.tables) for (const r of t.rows) if (r._pend) for (const k in r._pend) { st.push([r, k, r[k]]); r[k] = null; }
    try { return fn(); } finally { for (const [r, k, v] of st) r[k] = v; }
  }
  /** 自动运行时：切换到表并点击第 btn 个记录按钮 */
  async record(id, btn = 0) {
    this.checkAbort();
    if (this._replay) throw new ReplaySkip(); // 恢复设置时不重复记录数据
    const i = this.tables.findIndex((t) => t.id === id);
    if (this.curTable !== this.tables[i]) this.showTable(i);
    const t = this.tables[i];
    t.spec.buttons[btn].onClick(t);
    await this.wait(250);
  }
  onTableChanged() { this.analysisDone = this.analysisDone && true; }

  // ============================ 数据处理 & 报告 ============================
  modal(title, html, buttons = []) {
    const mask = h('div', 'modal-mask');
    const m = h('div', 'modal');
    m.innerHTML = `<div class="mh"><b>${title}</b><button class="btn small ghost" data-x>✕</button></div><div class="mb">${html}</div><div class="mf"></div>`;
    mask.append(m);
    document.body.append(mask);
    const close = () => mask.remove();
    m.querySelector('[data-x]').onclick = close;
    mask.addEventListener('pointerdown', (e) => { if (e.target === mask) close(); });
    const mf = m.querySelector('.mf');
    for (const b of buttons) {
      const bt = h('button', 'btn ' + (b.cls || ''), b.label);
      bt.onclick = () => b.onClick(close);
      mf.append(bt);
    }
    const cl = h('button', 'btn', '关闭'); cl.onclick = close; mf.append(cl);
    return { el: m, close, body: m.querySelector('.mb') };
  }

  computeAnalysis() {
    let res;
    try { res = this.studentView(() => this.exp.analyze()); } catch (err) { console.error(err); res = { html: `<p style="color:#f87171">数据处理出错：${err.message}</p>`, plots: [] }; }
    return res;
  }

  // ---------- 学生自算模式：先自己处理数据、填结果，再显示参考处理过程 ----------
  get selfCalc() { try { return localStorage.getItem('selfCalc') !== '0'; } catch { return true; } }
  set selfCalc(v) { try { localStorage.setItem('selfCalc', v ? '1' : '0'); } catch { /* 无痕模式等 */ } }
  dataKey() { return JSON.stringify(this.tables.map((t) => t.rows)); }
  /** 解析学生输入：普通数字、科学计数（1.2e-3 / 1.2×10^-3）、度分（60°05′） */
  parseAnswer(s, a) {
    s = String(s).trim().replace(/，/g, ',').replace(/−/g, '-').replace(/\s+/g, '');
    if (!s) return NaN;
    if (a.type === 'dms') { const m = s.match(/^(-?\d+(?:\.\d+)?)(?:[°度](\d+(?:\.\d+)?)?[′'分]?)?$/); return m ? +m[1] + (m[2] ? +m[2] / 60 : 0) : NaN; }
    s = s.replace(/[×x*]10\^?\(?(-?\d+)\)?/i, 'e$1');
    return Number(s);
  }
  judgeAnswers(answers, inputs) {
    return answers.map((a, i) => {
      const s = this.parseAnswer(inputs[i], a);
      const tolAbs = a.tolAbs ?? 0, tolRel = a.tolRel ?? 0.005;
      // 同一组数据可能有几种合理算法（逐差法 / 图线法），与其中任一个相符即可
      let best = { v: a.value, dev: Infinity, rel: Infinity };
      for (const v of [a.value, ...(a.alts || [])].filter(isFinite)) {
        const dev = Math.abs(s - v), rel = v ? dev / Math.abs(v) : dev;
        if (rel < best.rel || !isFinite(best.rel)) best = { v, dev, rel };
      }
      const ok = isFinite(s) && (best.dev <= tolAbs || best.rel <= tolRel);
      return { ...a, value: isFinite(s) ? best.v : a.value, input: inputs[i], s, rel: best.rel, ok };
    });
  }
  fmtAns(a, v) {
    if (!isFinite(v)) return '—';
    if (a.type === 'dms') { const d = Math.floor(Math.abs(v) + 1e-9), m = Math.round((Math.abs(v) - d) * 60); return `${v < 0 ? '−' : ''}${d}°${String(m).padStart(2, '0')}′`; }
    return v.toFixed(a.digits ?? 3);
  }
  feedbackHTML(fb) {
    const n = fb.filter((x) => x.ok).length;
    return `<div class="selfcheck"><h3>你的计算结果</h3><table><tr><th>物理量</th><th>你的结果</th><th>按你的数据计算的参考值</th><th>相对偏差</th><th></th></tr>
      ${fb.map((x) => `<tr class="${x.ok ? 'ok' : 'bad'}"><td>${renderMath(x.label)}</td><td>${isFinite(x.s) ? this.fmtAns(x, x.s) : (x.input ? `无法识别“${String(x.input).replace(/</g, '&lt;')}”` : '未填')}</td><td>${this.fmtAns(x, x.value)} ${x.unit || ''}</td><td>${isFinite(x.s) ? (x.rel * 100).toFixed(2) + '%' : '—'}</td><td>${x.ok ? '✓' : '✗'}</td></tr>`).join('')}</table>
      <p>${n === fb.length ? '全部正确。' : `${fb.length - n} 项与参考值不符（允许偏差约 0.5%）。对照下面的处理过程，找出是公式、单位还是有效数字的问题。`}</p></div>`;
  }

  showAnalysis() {
    if (this._replay) throw new ReplaySkip();
    const res = this.computeAnalysis();
    const ans = res.ok && res.answers && res.answers.length ? res.answers : null;
    const key = this.dataKey();
    // 自动演示或教师模式下直接显示；自算模式下，同一组数据只需提交一次
    if (ans && this.selfCalc && !this.running && !(this.selfRes && this.selfRes.key === key)) return this.askAnswers(res, ans, key);
    this.renderAnalysis(res, this.selfRes && this.selfRes.key === key ? this.selfRes.fb : null);
  }

  askAnswers(res, ans, key) {
    const prev = this.selfRes ? this.selfRes.inputs : [];
    const html = `<div class="selfcalc"><p>请先<b>用你自己记录的数据</b>完成计算（可用计算器，或复制数据到 Excel / WPS 表格），把最终结果填在下面。提交后会显示参考处理过程，并逐项给出偏差。</p>
      <div class="sc-tools"><button class="btn small" data-copy>复制全部数据（可粘贴到表格软件）</button><span class="sc-msg"></span></div>
      <div class="sc-form">${ans.map((a, i) => `<label><span>${renderMath(a.label)}</span><input data-i="${i}" inputmode="decimal" autocomplete="off" placeholder="${a.type === 'dms' ? '如 60°05′' : a.hint || '数值'}" value="${prev[i] ?? ''}"/><em>${a.unit ? renderMath(a.unit) : ''}</em></label>`).join('')}</div>
      <p class="sc-note">可写成 1.23e-3 或 1.23×10^-3；角度可写成 60°05′。</p></div>`;
    const md = this.modal(`数据处理 · 先自己算 · ${this.meta.title}`, html, [
      { label: '提交我的结果', cls: 'ink', onClick: (close) => {
        const inputs = [...md.body.querySelectorAll('.sc-form input')].map((x) => x.value);
        if (inputs.every((x) => !x.trim())) { this.toast('还没有填写任何结果', 'warn'); return; }
        const fb = this.judgeAnswers(ans, inputs);
        this.selfRes = { key, inputs, fb };
        close(); this.renderAnalysis(res, fb);
      } },
      { label: '不算了，直接看参考结果', onClick: (close) => { close(); this.renderAnalysis(res, null); } },
    ]);
    md.body.querySelector('[data-copy]').onclick = async () => {
      const txt = this.tables.map((t) => t.toTSV()).join('\n\n');
      const msg = md.body.querySelector('.sc-msg');
      try { await navigator.clipboard.writeText(txt); msg.textContent = '已复制'; }
      catch { const ta = h('textarea', 'sc-copy'); ta.value = txt; md.body.querySelector('.sc-tools').after(ta); ta.select(); msg.textContent = '浏览器不允许直接复制，请手动全选复制下面的文本'; }
    };
    const first = md.body.querySelector('.sc-form input'); first && setTimeout(() => first.focus(), 50);
  }

  renderAnalysis(res, fb) {
    const md = this.modal(`数据处理与结果 · ${this.meta.title}`, `${fb ? this.feedbackHTML(fb) : ''}<div class="ana">${renderMath(res.html)}</div>`, [
      { label: '生成实验报告', cls: 'ink', onClick: (close) => { close(); this.makeReport(); } },
      { label: this.selfCalc ? '以后直接显示结果' : '以后先自己算', onClick: (close) => { this.selfCalc = !this.selfCalc; this.toast(this.selfCalc ? '已切换为“先自己算”模式' : '已切换为直接显示结果', 'ok'); close(); } },
    ]);
    (res.plots || []).forEach((spec, i) => {
      const cv = md.body.querySelector(`canvas[data-plot="${i}"]`);
      if (cv) drawPlot(cv, spec);
    });
    this.lastAnalysis = res;
    if (res.ok) this.analysisDone = true;
  }

  makeReport() {
    const res = this.computeAnalysis();
    const plots = (res.plots || []).map((spec) => {
      const cv = document.createElement('canvas');
      cv.style.width = '760px'; cv.style.height = '380px';
      cv.width = 760; cv.height = 380;
      document.body.append(cv);
      drawPlot(cv, { ...spec, light: true });
      const url = cv.toDataURL('image/png');
      cv.remove();
      return url;
    });
    let ana = renderMath(res.html);
    plots.forEach((url, i) => {
      ana = ana.replace(new RegExp(`<canvas data-plot="${i}"[^>]*></canvas>`), `<img src="${url}" style="width:100%;max-width:760px"/>`);
    });
    const shot = this.stage.renderer.domElement.toDataURL('image/jpeg', 0.85);
    const date = new Date().toLocaleString('zh-CN');
    const stepsHtml = this.steps.map((s, i) => `<li>${this.stepDone[i] ? '☑' : '☐'} ${s.title}</li>`).join('');
    const katexCss = [...document.styleSheets].map((ss) => { try { return [...ss.cssRules].map((r) => r.cssText).join('\n'); } catch { return ''; } }).join('\n').split('\n').filter((l) => l.includes('katex')).join('\n');
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>实验报告 - ${this.meta.title}</title>
<style>${katexCss}
body{font-family:"Microsoft YaHei","PingFang SC",sans-serif;max-width:860px;margin:24px auto;padding:0 24px;color:#111;line-height:1.75}
h1{text-align:center;font-size:24px;margin-bottom:4px} .sub{text-align:center;color:#555;margin-bottom:20px}
h2{border-left:5px solid #0284c7;padding-left:10px;font-size:18px;margin-top:28px} h3{font-size:15px}
table{border-collapse:collapse;margin:8px 0;font-size:13px} td,th{border:1px solid #999;padding:4px 10px;text-align:center} th{background:#eef2f7}
.info td{border:none;text-align:left;padding:2px 12px 2px 0} .info input{border:none;border-bottom:1px solid #333;font-size:14px;width:160px}
.result-box{border:1px solid #16a34a;background:#f0fdf4;padding:8px 12px;border-radius:6px} .result-box.warn{border-color:#ca8a04;background:#fefce8}
.selfcheck tr.bad td:last-child{color:#b91c1c}.selfcheck tr.ok td:last-child{color:#15803d} .plot-wrap{margin:8px 0} img.shot{width:100%;border:1px solid #ccc;border-radius:6px} ul{columns:2}
.noprint{position:fixed;right:20px;top:20px} @media print{.noprint{display:none}}
</style></head><body>
<div class="noprint"><button onclick="print()" style="padding:8px 18px;font-size:15px">打印 / 另存为 PDF</button></div>
<h1>${this.meta.title}</h1><div class="sub">实验报告 · 虚拟仿真实验 · ${date}</div>
<table class="info"><tr><td>专业班级：<input></td><td>姓名：<input></td><td>学号：<input></td></tr><tr><td>同组者：<input></td><td>指导教师：<input></td><td>成绩：<input></td></tr></table>
<h2>一、实验目的</h2>${this.meta.goals ? '<ol>' + this.meta.goals.map((g) => `<li>${g}</li>`).join('') + '</ol>' : ''}
<h2>二、实验原理</h2><div>${renderMath(this.exp.principle())}</div>
<h2>三、实验装置</h2><img class="shot" src="${shot}"/>
<p>${this.placedComps().map((c) => c.name).join('、')}</p>
<h2>四、实验步骤完成情况</h2><ul>${stepsHtml}</ul>
<h2>五、数据记录</h2>${this.tables.map((t) => t.toHTML()).join('')}
<h2>六、数据处理与结果</h2>${this.selfRes && this.selfRes.key === this.dataKey() ? this.feedbackHTML(this.selfRes.fb).replace('<h3>你的计算结果</h3>', '<h3>学生自算结果与核对</h3>') : ''}${ana}
<h2>七、讨论与思考</h2>${this.meta.questions ? '<ol>' + this.meta.questions.map((q) => `<li>${q}<br><br><br></li>`).join('') + '</ol>' : ''}
</body></html>`;
    const w = window.open('', '_blank');
    if (!w) { this.toast('浏览器拦截了弹出窗口，请允许本页面弹窗后重试', 'bad'); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  // ============================ 杂项 ============================
  toast(msg, type = '') {
    const t = h('div', 'toast ' + type, msg);
    this.toastsEl.append(t);
    setTimeout(() => { t.style.transition = 'opacity .4s'; t.style.opacity = 0; setTimeout(() => t.remove(), 400); }, 2600);
    while (this.toastsEl.children.length > 4) this.toastsEl.firstChild.remove();
  }

  restart() {
    const { root, ExpClass, onExit } = this;
    this.dispose();
    const app = new App(root, ExpClass, { onExit });
    window.__app = app;
  }
  exit() { this.dispose(); this.onExit && this.onExit(); }
  dispose() {
    this._abort = true;
    clearInterval(this._checkTimer);
    window.removeEventListener('pointermove', this._mv);
    window.removeEventListener('pointerup', this._up);
    this.exp.dispose && this.exp.dispose();
    for (const v of this.views.values()) v.dispose();
    this.stage.dispose();
    document.querySelectorAll('.vw.big, .view-mask, .modal-mask').forEach((e) => e.remove());
    this.root.innerHTML = '';
  }
}
