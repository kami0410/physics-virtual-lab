// 实验：克拉尼图形与方板的振动模式
// 方形钢板中心用螺钉固定在电磁振动器上，信号发生器经功率放大驱动振动器。扫频时，板在各固有频率附近共振，
// 撒在板上的沙粒从振动大的地方被抛开，聚集到不动的节线上，形成克拉尼图形。
// 振型与固有频率由 physics/chladni.js 用瑞利–里茨法算出（中心固定、四边自由的 Kirchhoff 薄板）；
// 板不是严格的正方形（边长差千分之几），理想对称下简并的模式分裂成两个很近的共振。
import * as THREE from 'three';
import { meta, thumb } from './chladni.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox } from '../core/Models.js';
import { mean, stdev, rand, gauss, relErr, pct, clamp, fmtU, tFactor } from '../core/Stats.js';
import { plateModes, modeField, plateFreq } from '../physics/chladni.js';

const GN = 97; // 振型网格
const NSAND = 6000, GRAV = 9.8;
const L0 = 0.24, NU = 0.29, RHO = 7850;
const ATLAS = 24; // 图谱中列出的模式数
const NMODE = 36; // 参与叠加的模式数
const SVG = (inner) => `<svg viewBox="0 0 64 40">${inner}</svg>`;

export class ChladniExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.delta = rand(0.0015, 0.003); // 板的长宽差（相对）
    this.E = rand(196, 210) * 1e9;
    const mk = (name, h0) => { const h = h0 * (1 + gauss(0.006)); return { name, h0, h, hm: Math.round((h + gauss(0.0015e-3)) * 1e6) / 1e6, zeta: rand(0.0035, 0.005), eps: [] }; };
    this.plates = { A: mk('钢板 A', 0.8e-3), B: mk('钢板 B', 1.0e-3) };
    this.pk = null; this.on = false; // pk：振动器上装的是哪块板（'A' | 'B' | null），由拖放决定 this.f = 100; this.drive = 4; this.snd = false;
    this.sx = new Float32Array(NSAND); this.sy = new Float32Array(NSAND); this.sand = 0;
    this.amp = new Float32Array(GN * GN); this._key = ''; this.acc = 0; this.dom = null;
  }
  get plate() { return this.plates[this.pk] || { name: '振动器上没有钢板', hm: 0 }; }
  /** 振动器推杆上装的板 */
  mounted() { const z = this.app.zones && this.app.zones.find((q) => q.id === 'mount'); return z && z.occupant ? z.occupant.key.slice(1) : null; }
  syncPlates() {
    this.pk = this.mounted();
    for (const k of ['A', 'B']) { const c = this.app.comp('p' + k); if (c) c.plateMesh.material[2] = this.pk === k ? this.topMat : c.plainTop; }
    this._key = '';
  }
  canPlace(comp, o = {}) {
    const sl = o.slot ?? comp.defaultSlot;
    if (sl === 'mount' && this.on && this.drive > 0) return '推杆正在振动，拧不上螺钉：先把信号发生器关掉';
    return null;
  }
  onPlace(c) { if (c && c.key[0] === 'p') { this.syncPlates(); this.app.changed(); } }
  onSlotChange(c, from) { if (c && c.key[0] === 'p') { if (from === 'mount') this.dropSand(); this.syncPlates(); this.app.changed(); } }
  onRemove(c) { if (c && c.key[0] === 'p') { if (this.app.slotOf(c.key) === 'mount' || this.pk === c.key.slice(1)) this.dropSand(); this.syncPlates(); } }
  dropSand() { if (this.sand) this.app.toast('板一拿下来，上面的沙全撒了', 'warn'); this.sweepOff(); }
  /** 自动操作：把 pk 板装到振动器上（另一块先放回台面） */
  async mountPlate(pk) {
    const a = this.app;
    if (this.mounted() === pk) return;
    if (this.on) { a.select(a.comp('gen')); this.on = false; a.renderInspector(); await a.wait(200); }
    const cur = this.mounted(); if (cur) { a.moveSlot(a.comp('p' + cur), 'rest' + cur); await a.wait(200); }
    await a.autoPut('p' + pk, 'mount');
    this.syncPlates();
  }
  /** 当前板第 n 个模式的固有频率（Hz） */
  fn(n, pk = this.pk) { const p = this.plates[pk]; return plateFreq(this.modes[n].lam, { L: L0, h: p.h, E: this.E, rho: RHO, nu: NU }); }

  // ======================= 物理 =======================
  solve() {
    const M = plateModes({ Lx: 1 + this.delta, Ly: 1 - this.delta, nu: NU, N: 18 });
    this.modes = M.modes.slice(0, NMODE);
    this.fields = this.modes.map((m) => modeField(m.c, M.N, GN));
    for (const p of Object.values(this.plates)) p.eps = this.modes.map(() => gauss(0.035));
  }
  /** 板上各点加速度幅值与 g 之比（网格），以及主导模式 */
  response() {
    const key = [this.pk, this.on, this.f, this.drive].join();
    if (key === this._key) return;
    this._key = key;
    const amp = this.amp, p = this.plate;
    if (!this.on || this.drive <= 0 || !this.pk) { amp.fill(0); this.acc = 0; this.dom = null; return; }
    const w = 2 * Math.PI * this.f, ab = this.drive * 1.5, ub = ab / (w * w); // 振动器：加速度幅值与频率无关
    const re = new Float64Array(GN * GN).fill(ub), im = new Float64Array(GN * GN);
    let best = null;
    this.modes.forEach((m, n) => {
      const wn = 2 * Math.PI * this.fn(n), z = p.zeta, G = m.part + p.eps[n];
      const dr = wn * wn - w * w, di = 2 * z * wn * w, den = dr * dr + di * di;
      const qr = (w * w * ub * G * dr) / den, qi = (-w * w * ub * G * di) / den, q = Math.hypot(qr, qi);
      const r = 1 / Math.sqrt(1 + (dr / di) ** 2);
      if (r > 0.3 && (!best || q > best.q)) best = { n, q, r };
      if (q < ub * 1e-3) return;
      const F = this.fields[n];
      for (let i = 0; i < F.length; i++) { re[i] += qr * F[i]; im[i] += qi * F[i]; }
    });
    let s = 0;
    for (let i = 0; i < amp.length; i++) { amp[i] = (w * w * Math.hypot(re[i], im[i])) / GRAV; s += amp[i]; }
    this.acc = s / amp.length;
    this.dom = best && best.q > 2 * ub ? best : null;
  }
  A(x, y) {
    const u = ((x + 1) / 2) * (GN - 1), v = ((y + 1) / 2) * (GN - 1), i = clamp(Math.floor(u), 0, GN - 2), j = clamp(Math.floor(v), 0, GN - 2), fu = u - i, fv = v - j, a = this.amp;
    return (a[j * GN + i] * (1 - fu) + a[j * GN + i + 1] * fu) * (1 - fv) + (a[(j + 1) * GN + i] * (1 - fu) + a[(j + 1) * GN + i + 1] * fu) * fv;
  }
  sprinkle() {
    if (!this.pk) { this.app.toast('振动器上还没装钢板，沙会撒在台上', 'warn'); return; }
    for (let i = 0; i < NSAND; i++) {
      let x, y; do { x = rand(-0.97, 0.97); y = rand(-0.97, 0.97); } while (x * x + y * y < 0.004);
      this.sx[i] = x; this.sy[i] = y;
    }
    this.sand = NSAND; this._moved = true; this.app.changed();
  }
  sweepOff() { this.sx.fill(NaN); this.sy.fill(NaN); this.sand = 0; this._moved = true; this.app.changed(); }
  /** 沙粒运动：加速度幅值超过 g 处被抛起，落点随机；跳出板边就掉下去 */
  stepSand(h) {
    if (!this.sand || !this.acc) return;
    const rate = 30 * h;
    let alive = 0, moved = false;
    for (let i = 0; i < NSAND; i++) {
      let x = this.sx[i], y = this.sy[i];
      if (x !== x) continue;
      const a = this.A(x, y);
      if (a > 1 && Math.random() < rate) {
        const s = 0.011 * Math.sqrt(Math.min(a - 1, 8));
        x += gauss(s); y += gauss(s); moved = true;
        if (Math.abs(x) > 1 || Math.abs(y) > 1) { x = y = NaN; }
        this.sx[i] = x; this.sy[i] = y;
      }
      if (x === x) alive++;
    }
    this.sand = alive;
    if (moved) this._moved = true;
  }
  tick(dt) {
    this.response();
    const a = this.app, T = Math.min(0.5, dt * (a.running ? Math.max(1, a.speed) : 1));
    for (let t = 0; t < T - 1e-9; t += 0.02) this.stepSand(Math.min(0.02, T - t));
    if (this._moved) { this._moved = false; this._sv = (this._sv | 0) + 1; a.changed(); } // _sv：沙粒分布的版本号，变了才重画板面纹理
    if (this.snd && this.ac) {
      const now = this.ac.currentTime, g = this.on ? Math.min(0.22, 0.004 * this.acc) : 0;
      this.osc.frequency.setTargetAtTime(this.f, now, 0.02); this.gain.gain.setTargetAtTime(g, now, 0.05);
    }
  }
  setSound(v) {
    this.snd = v;
    if (v && !this.ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ac = new AC(); this.osc = this.ac.createOscillator(); this.gain = this.ac.createGain();
      this.gain.gain.value = 0; this.osc.connect(this.gain).connect(this.ac.destination); this.osc.start();
    }
    if (this.ac) { if (v) this.ac.resume(); else this.gain.gain.setTargetAtTime(0, this.ac.currentTime, 0.03); }
  }
  dispose() { if (this.ac) { try { this.osc.stop(); this.ac.close(); } catch { /* 已关闭 */ } this.ac = null; } }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [0, 62, 70], target: [0, 8, 0] }, { name: '俯视', pos: [0, 58, 6], target: [0, 14, 0] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    this.solve();
    scene.add(benchTable(130, 80));
    app.stage.setLightTarget(0, 10, 0);
    const g = new THREE.Group(), dark = MAT.paint(0x2b3440), alu = MAT.alu();
    g.add(mesh(new THREE.CylinderGeometry(7, 8, 9, 32), dark, 0, 4.5, 0));
    g.add(mesh(new THREE.CylinderGeometry(7.2, 7.2, 0.6, 32), alu, 0, 9.2, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 4.5, 12), MAT.chrome(), 0, 11.5, 0));
    // 钢板：顶面贴俯视画面
    this.tex = document.createElement('canvas'); this.tex.width = this.tex.height = 512;
    this.ctex = new THREE.CanvasTexture(this.tex); this.ctex.colorSpace = THREE.SRGBColorSpace;
    const top = new THREE.MeshStandardMaterial({ map: this.ctex, roughness: 0.55, metalness: 0.3 });
    const side = MAT.paint(0x1f2326);
    this.topMat = top;
    // 两块钢板：从器材柜拖到振动器推杆上（中心螺钉固定），不用的放在台面上
    app.addSlot({ id: 'mount', pos: new THREE.Vector3(0, 13.78, 0), accepts: ['pA', 'pB'], label: '振动器推杆（中心螺钉）', r: 3, snap: 10 });
    app.addSlot({ id: 'restA', pos: new THREE.Vector3(36, 0.02, 18), accepts: ['pA'], label: '台面', r: 6, snap: 12 });
    app.addSlot({ id: 'restB', pos: new THREE.Vector3(36, 0.02, -12), accepts: ['pB'], label: '台面', r: 6, snap: 12 });
    for (const k of ['A', 'B']) {
      const th = k === 'A' ? 0.22 : 0.28, pg = new THREE.Group(), plain = MAT.paint(0x24282b);
      const pm = new THREE.Mesh(new THREE.BoxGeometry(24, th, 24), [side, side, plain, side, side, side]); pm.position.y = th / 2; pm.castShadow = true; pg.add(pm);
      const c = new Component({
        key: 'p' + k, name: `钢板 ${k}`, zone: 'slot', defaultSlot: 'mount', object: pg, labelY: 3,
        icon: SVG(`<rect x="12" y="${k === 'A' ? 16 : 15}" width="40" height="${k === 'A' ? 4 : 6}" fill="currentColor"/>`),
        desc: `边长 240.0 mm 的方形钢板，千分尺测得厚 ${(this.plates[k].hm * 1e3).toFixed(3)} mm，板面涂黑。拖到振动器推杆上用中心螺钉固定，拖回台面或器材柜就是卸下（板上的沙会撒掉）。`,
      });
      c.plateMesh = pm; c.plainTop = plain;
      app.addComponent(c);
    }
    g.add(mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.5, 6), MAT.chrome(), 0, 14.25, 0));
    app.addComponent(new Component({
      key: 'rig', name: '电磁振动器', zone: 'none', fixed: true, required: true, object: g, labelY: 20,
      icon: SVG('<rect x="14" y="4" width="36" height="22" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M14 4 L50 26 M50 4 L14 26" stroke="currentColor" stroke-dasharray="2 2"/><rect x="26" y="28" width="12" height="9" fill="currentColor" opacity=".5"/>'),
      desc: `方形钢板边长 240.0 mm，中心用螺钉固定在电磁振动器的推杆上，四边自由。两块板用同一种钢材，厚度用千分尺测得：A 板 ${(this.plates.A.hm * 1e3).toFixed(3)} mm，B 板 ${(this.plates.B.hm * 1e3).toFixed(3)} mm。钢的密度 7.85 g/cm³，泊松比 0.29。板面涂黑，撒上细沙（白色）便于观察。`,
      controls: () => [
        { type: 'readout', label: '推杆上装的', get: () => (this.pk ? `钢板 ${this.pk}（${(this.plates[this.pk].hm * 1e3).toFixed(2)} mm）` : '没有板：从器材柜拖一块上来') },
        { type: 'button', label: '均匀撒一层沙', onClick: () => this.sprinkle() },
        { type: 'button', label: '把沙扫掉', onClick: () => this.sweepOff() },
        { type: 'readout', label: '板上的沙粒', get: () => (this.sand ? `约 ${Math.round(this.sand / 60)} mg（${((this.sand / NSAND) * 100).toFixed(0)}%）` : '没有沙') },
      ],
    }));
    const gb = (this.genBox = meterBox(22, 10, 13, '信号发生器 · 功放')); gb.group.position.set(-42, 0, -14);
    app.addComponent(new Component({
      key: 'gen', name: '信号发生器（带功率放大）', zone: 'none', fixed: true, object: gb.group, labelY: 15,
      desc: '输出正弦信号经功率放大推动振动器，频率 20–2000 Hz，显示到 0.1 Hz。振动器推杆的加速度幅值大致与频率无关、与“输出幅度”成正比。可以打开扬声器监听：板共振时发出很响的声音。',
      controls: () => [
        { type: 'toggle', label: '电源', get: () => this.on, set: (v) => { this.on = v; app.changed(); } },
        { type: 'knob', label: '频率', get: () => this.f, set: (v) => { this.f = Math.round(clamp(v, 20, 2000) * 10) / 10; app.changed(); }, min: 20, max: 2000, step: 0.1, bigStep: 10, perRev: 20, digits: 1, unit: 'Hz' },
        { type: 'knob', label: '输出幅度', get: () => this.drive, set: (v) => { this.drive = clamp(v, 0, 10); app.changed(); }, min: 0, max: 10, step: 0.1, bigStep: 1, perRev: 5, digits: 1 },
        { type: 'toggle', label: '监听板的声音', get: () => this.snd, set: (v) => this.setSound(v) },
      ],
    }));
    this.tv = app.addView({ id: 'top', title: '俯视：板面上的沙', w: 300, h: 300, res: 1.4 });
    this.av = app.addView({ id: 'atlas', title: '振型图谱（中心固定的方板，编号按频率由低到高，右下为 λ）', w: 340, h: 330, res: 1.4 });
    this.drawAtlas();
  }
  update() {
    this.response();
    const s = this.on ? this.f.toFixed(1) : '----';
    if (s !== this._gs || this._gd !== this.drive) { this._gs = s; this._gd = this.drive; this.genBox.setText(s, this.on ? 'Hz' : '', this.on ? `输出幅度 ${this.drive.toFixed(1)}` : '电源关'); }
    this.drawTop(); this.showAtlas();
  }
  drawPlate(g, x0, y0, S) {
    g.fillStyle = '#1f2326'; g.fillRect(x0, y0, S, S);
    const grd = g.createLinearGradient(x0, y0, x0 + S, y0 + S); grd.addColorStop(0, 'rgba(255,255,255,.06)'); grd.addColorStop(1, 'rgba(0,0,0,.1)');
    g.fillStyle = grd; g.fillRect(x0, y0, S, S);
  }
  drawPin(g, x0, y0, S) { g.fillStyle = '#9aa1a8'; g.beginPath(); g.arc(x0 + S / 2, y0 + S / 2, S * 0.022, 0, 7); g.fill(); }
  /** 俯视图：沙粒合成一条路径一次填充（6000 次 fillRect 改为一次 fill） */
  drawSand(g, x0, y0, S, dot) {
    this.drawPlate(g, x0, y0, S);
    g.fillStyle = '#ece3cc'; g.beginPath();
    for (let i = 0; i < NSAND; i++) { const x = this.sx[i]; if (x !== x) continue; g.rect(x0 + ((x + 1) / 2) * S - dot / 2, y0 + ((1 - this.sy[i]) / 2) * S - dot / 2, dot, dot); }
    g.fill();
    this.drawPin(g, x0, y0, S);
  }
  /** 三维板面的 512×512 纹理：沙粒直接写像素；沙粒没动就不重画、不重新上传显卡 */
  drawSandTex() {
    const ver = this._sv | 0;
    if (ver === this._tv) return;
    this._tv = ver;
    const N = 512, g = this.tex.getContext('2d');
    if (!this._texBg) { // 板面底色和渐变只画一次，之后每次整块复制
      this.drawPlate(g, 0, 0, N);
      this._texImg = g.getImageData(0, 0, N, N);
      this._texPx = new Uint32Array(this._texImg.data.buffer);
      this._texBg = this._texPx.slice();
    }
    const px = this._texPx, C = 0xffcce3ec; // #ece3cc（RGBA 字节按小端序存为 ABGR）
    px.set(this._texBg);
    for (let i = 0; i < NSAND; i++) {
      const x = this.sx[i]; if (x !== x) continue;
      const u = Math.round(((x + 1) / 2) * N) - 1, v = Math.round(((1 - this.sy[i]) / 2) * N) - 1;
      if (u < 0 || v < 0 || u > N - 2 || v > N - 2) continue;
      const k = v * N + u; px[k] = px[k + 1] = px[k + N] = px[k + N + 1] = C;
    }
    g.putImageData(this._texImg, 0, 0);
    this.drawPin(g, 0, 0, N);
    this.ctex.needsUpdate = true;
  }
  drawTop() {
    const v = this.tv, g = v.ctx, W = v.W, H = v.H, S = Math.min(W, H) * 0.9;
    g.fillStyle = '#d8d4cb'; g.fillRect(0, 0, W, H);
    this.drawSand(g, (W - S) / 2, (H - S) / 2, S, Math.max(1, W / 260));
    this.drawSandTex();
    const p = this.plate, d = this.dom;
    v.foot(!this.pk ? '振动器上没有钢板' : !this.on ? '信号发生器没有打开' : !this.sand ? '板上没有沙：点“均匀撒一层沙”' : this.acc < 0.6 ? `f = ${this.f.toFixed(1)} Hz：不在共振频率上，沙粒不动` : d && d.r > 0.9 ? `f = ${this.f.toFixed(1)} Hz：共振，沙粒聚向节线（${p.name}）` : `f = ${this.f.toFixed(1)} Hz：接近共振，沙在跳动；微调频率使图形最清晰`);
  }
  drawAtlas() {
    const v = this.av, W = v.W, H = v.H, cv = (this.atlasCv = document.createElement('canvas'));
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), cols = 6, rows = 4, pad = 6, cw = (W - pad) / cols, chh = (H - pad) / rows, fs = Math.round(H * 0.036), s = Math.floor(Math.min(cw, chh - fs * 1.3) - pad);
    g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, W, H);
    const img = g.createImageData(Math.ceil(s), Math.ceil(s));
    for (let k = 0; k < ATLAS; k++) {
      const F = this.fields[k], cx = pad + (k % cols) * cw, cy = pad + Math.floor(k / cols) * chh, n = img.width;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const u = Math.round((i / (n - 1)) * (GN - 1)), w = Math.round((1 - j / (n - 1)) * (GN - 1)), a = F[w * GN + u];
        const r = Math.min(GN - 1, u + 1), b = Math.max(0, w - 1), node = a * F[w * GN + r] <= 0 || a * F[b * GN + u] <= 0, o = (j * n + i) * 4;
        const c = node ? [29, 40, 50] : a > 0 ? [214, 222, 230] : [238, 226, 205];
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
      g.putImageData(img, Math.round(cx), Math.round(cy));
      g.font = `bold ${fs}px "IBM Plex Mono", monospace`; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      g.fillStyle = '#1d2832'; g.fillText(`${k + 1}`, cx, cy + s + fs * 1.1);
      g.font = `${Math.round(fs * 0.9)}px "IBM Plex Mono", monospace`; g.textAlign = 'right'; g.fillStyle = '#5b6770';
      g.fillText(this.modes[k].lam.toFixed(1), cx + s, cy + s + fs * 1.1);
    }
    this._atlasURL = cv.toDataURL();
  }
  showAtlas() {
    const v = this.av;
    v.ctx.drawImage(this.atlasCv, 0, 0, v.W, v.H);
    v.foot('深色线为节线；λ = 2πfL²√(ρh/D) 是无量纲频率参数，只与板的形状、泊松比和支撑方式有关');
  }

  // ======================= 数据表 =======================
  lamOf(k) { return k >= 1 && k <= ATLAS ? this.modes[k - 1].lam : NaN; }
  Eof(f, k, h) { const lam = this.lamOf(k); return ((12 * (1 - NU * NU) * RHO) * ((2 * Math.PI * f * L0 * L0) / (lam * h)) ** 2) / 1e9; }
  tables() {
    return [{
      id: 'res', title: '共振频率与振动模式', maxRows: 20,
      columns: [
        { key: 'plate', label: '钢板', type: 'text', auto: true },
        { key: 'f', label: 'f/Hz', digits: 1, auto: true },
        { key: 'k', label: '图谱编号', digits: 0, readTol: 0.5 },
        { key: 'lam', label: 'λ', digits: 2, calc: (r) => this.lamOf(Math.round(r.k)) },
        { key: 'E', label: 'E/GPa', digits: 1, calc: (r) => this.Eof(r.f, Math.round(r.k), r._h) },
      ],
      buttons: [{ label: '记录当前共振', onClick: (t) => this.rec(t) }],
      note: '在共振处把频率微调到图形最清晰，点“记录”，再对照振型图谱找出这个图形的编号填进表里（两个很近的频率常常是同一形状转过 90°，图谱里是相邻的两个编号）。',
    }];
  }
  rec(t) {
    this.response();
    const a = this.app, d = this.dom;
    if (!this.pk) return a.toast('振动器上没有钢板', 'warn');
    if (!this.on || this.drive <= 0) return a.toast('信号发生器没有打开', 'warn');
    if (!this.sand) return a.toast('板上没有沙，看不到图形，先撒沙', 'warn');
    if (!d || d.r < 0.5) return a.toast('现在不在共振频率上，沙粒不动、没有图形', 'warn');
    if (d.n >= ATLAS) return a.toast('这个模式超出了图谱的范围（频率太高），换一个低一些的共振', 'warn');
    if (d.r < 0.85) a.toast('离共振峰还有点距离，图形不够清晰，再微调一下频率', 'warn');
    if (t.rows.some((r) => r.plate === this.pk && Math.round(r._k) === d.n + 1)) a.toast('这块板的这个图形已经记过了', 'warn');
    t.addRow({ plate: this.pk, f: this.f, k: d.n + 1, _k: d.n + 1, _h: this.plate.hm });
  }

  // ======================= 自动操作 =======================
  async setF(f) { const a = this.app; a.select(a.comp('gen')); await a.tween(() => this.f, (v) => (this.f = Math.round(v * 10) / 10), f, 700); this.f = Math.round(f * 10) / 10; a.changed(); }
  /** 某块板上最容易激起的模式（按激励强度排序，取前 n 个，再按频率排） */
  strong(pk, n) {
    const p = this.plates[pk], save = [this.pk, this.on, this.f, this.drive], out = [];
    this.pk = pk; this.on = true; this.drive = 4;
    for (let i = 0; i < ATLAS - 1; i++) {
      this.f = Math.round(this.fn(i) * 10) / 10; this.response();
      if (this.dom && this.dom.n === i && this.dom.r > 0.9) out.push({ i, s: Math.abs(this.modes[i].part + p.eps[i]) });
    }
    [this.pk, this.on, this.f, this.drive] = save; this._key = ''; this.response();
    return out.sort((x, y) => y.s - x.s).slice(0, n).map((x) => x.i).sort((x, y) => x - y);
  }
  async capture(i) {
    const a = this.app;
    if (this.sand < NSAND * 0.6 || !this._fresh) { this.sprinkle(); }
    await this.setF(this.fn(i));
    this._fresh = false;
    await a.wait(2600);
    await a.record('res', 0);
    this.sprinkle(); this._fresh = true;
  }
  steps() {
    const app = this.app, rows = (pk) => app.table('res').rows.filter((r) => r.plate === pk && r.f > 0 && r.k >= 1);
    const fix = () => ({ label: '帮我调到最近的共振', run: async () => { const w = this.f, n = this.modes.reduce((b, m, i) => (Math.abs(this.fn(i) - w) < Math.abs(this.fn(b) - w) ? i : b), 0); await this.setF(this.fn(n)); } });
    const diag = () => {
      if (!this.on) return [{ msg: '信号发生器没有打开。', fix: { label: '打开', run: async () => { this.on = true; if (this.drive < 1) this.drive = 4; } } }];
      if (!this.sand) return [{ msg: '板上没有沙。', fix: { label: '撒沙', run: async () => this.sprinkle() } }];
      if (this.drive < 1) return [{ msg: '输出幅度太小，共振时沙也跳不起来。', fix: { label: '幅度调到 4', run: async () => { this.drive = 4; } } }];
      const d = this.dom;
      if (!d || d.r < 0.5) return [{ msg: `${this.f.toFixed(1)} Hz 不是共振频率。慢慢扫频：沙粒开始跳动时放慢，找到图形最清晰的频率。`, fix: fix() }];
      if (d.r < 0.9) return [{ msg: '接近共振了，来回微调频率，停在沙粒跳得最厉害、节线最清楚的地方。', fix: fix() }];
      return [{ msg: '现在正在共振：等沙粒聚成线，点“记录当前共振”，然后到振型图谱里找编号。' }];
    };
    return [
      {
        title: '打开信号源，撒沙',
        html: '<p>从器材柜把 A 板拖到振动器推杆上，打开信号发生器，输出幅度 4 左右，在板上均匀撒一层细沙。</p>',
        check: () => this.on && this.drive >= 1 && this.sand > NSAND * 0.5 && this.pk === 'A',
        status: () => `${this.on ? `${this.f.toFixed(1)} Hz` : '信号源关'}，${this.sand ? '已撒沙' : '没有沙'}，${this.plate.name}`,
        diagnose: () => (this.pk !== 'A' ? [{ msg: '先把 A 板装到振动器上。', fix: { label: '装上 A 板', run: () => this.mountPlate('A') } }] : diag()),
        auto: async () => {
          await this.mountPlate('A');
          this.sprinkle(); this._fresh = true;
          app.select(app.comp('gen')); this.on = true; this.drive = 4; app.renderInspector(); await this.setF(40);
          await app.view('俯视');
        },
      },
      {
        title: '扫频，记录 8 种克拉尼图形',
        html: '<p>从 30 Hz 起慢慢升高频率（大约到 1000 Hz）。到某个固有频率附近，沙粒开始跳动、向节线聚集。来回微调到图形最清晰，点“记录当前共振”，再和振型图谱对照填上编号。每记完一个图形把沙扫掉重撒。</p>',
        hint: '振幅太大时沙会被抛出板外，节线也变粗；振幅太小则只有离节线很近的沙不动、图形发虚。共振峰很窄（约 ±0.5%），升频要慢。',
        status: () => `A 板已记录 ${new Set(rows('A').map((r) => Math.round(r._k))).size} 种图形`,
        check: () => new Set(rows('A').map((r) => Math.round(r._k))).size >= 8,
        diagnose: diag,
        auto: async () => {
          if (this.pk !== 'A') { await this.mountPlate('A'); this.sprinkle(); }
          if (!this.on) { this.on = true; this.drive = 4; }
          app.showTable(0); await app.view('俯视');
          for (const i of this.strong('A', 9)) {
            if (new Set(rows('A').map((r) => Math.round(r._k))).size >= 8) break;
            if (rows('A').some((r) => Math.round(r._k) === i + 1)) continue;
            await this.capture(i);
          }
        },
      },
      {
        title: '换 B 板，比较同一图形的频率',
        html: '<p>关掉信号源，把 A 板卸下放回台面，再把较厚的 B 板拖到推杆上，找出至少 3 个在 A 板上已经记录过的图形，记下它们的共振频率。</p>',
        status: () => { const ka = new Set(rows('A').map((r) => Math.round(r._k))); return `B 板上已找到 ${rows('B').filter((r) => ka.has(Math.round(r._k))).length} 个与 A 板相同的图形`; },
        check: () => { const ka = new Set(rows('A').map((r) => Math.round(r._k))); return rows('B').filter((r) => ka.has(Math.round(r._k))).length >= 3; },
        diagnose: () => (this.pk !== 'B' ? [{ msg: '振动器上装的不是 B 板：关掉信号源，卸下 A 板放回台面，把 B 板拖到推杆上。', fix: { label: '换成 B 板并撒沙', run: async () => { await this.mountPlate('B'); this.sprinkle(); } } }] : diag()),
        auto: async () => {
          await this.mountPlate('B');
          if (!this.on) { this.on = true; this.drive = 4; }
          this.sprinkle(); this._fresh = true;
          const ka = new Set(rows('A').map((r) => Math.round(r._k)));
          const cand = this.strong('B', 12).filter((i) => ka.has(i + 1));
          for (const i of cand) {
            if (rows('B').filter((r) => ka.has(Math.round(r._k))).length >= 4) break;
            if (rows('B').some((r) => Math.round(r._k) === i + 1)) continue;
            await this.capture(i);
          }
        },
      },
      {
        title: '数据处理',
        html: '<p>作 A 板的 $f$–$\\lambda$ 图，由斜率求钢的杨氏模量；比较同一模式在两块板上的频率比与厚度比。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app, ok = (r) => r.f > 0 && r.k >= 1 && r.k <= ATLAS;
    const all = a.table('res').rows.filter(ok), A = all.filter((r) => r.plate === 'A'), B = all.filter((r) => r.plate === 'B');
    if (A.length < 3) return { html: '<p>A 板至少需要 3 个已辨认的图形（建议 8 个）。</p>', ok: false };
    const hA = this.plates.A.hm, hB = this.plates.B.hm, lam = (r) => this.lamOf(Math.round(r.k));
    const Es = A.map((r) => this.Eof(r.f, Math.round(r.k), hA)), Em = mean(Es), uA = A.length > 1 ? (tFactor(A.length) * stdev(Es)) / Math.sqrt(A.length) : 0;
    const uh = 0.004e-3 / Math.sqrt(3), uE = Math.hypot(uA, Em * 2 * (uh / hA));
    const sl = A.reduce((s, r) => s + r.f * lam(r), 0) / A.reduce((s, r) => s + lam(r) ** 2, 0);
    const Es2 = ((12 * (1 - NU * NU) * RHO) * ((2 * Math.PI * sl * L0 * L0) / hA) ** 2) / 1e9;
    let html = `<h3>1. A 板（h = ${(hA * 1e3).toFixed(3)} mm）</h3>
      <table><tr><th>编号</th><th>f/Hz</th><th>λ</th><th>f/λ /Hz</th><th>E/GPa</th></tr>${A.map((r, i) => `<tr><td>${Math.round(r.k)}</td><td>${r.f.toFixed(1)}</td><td>${lam(r).toFixed(2)}</td><td>${(r.f / lam(r)).toFixed(3)}</td><td>${Es[i].toFixed(1)}</td></tr>`).join('')}</table>
      <p>由 $f=\\dfrac{\\lambda}{2\\pi L^2}\\sqrt{\\dfrac{Eh^2}{12(1-\\nu^2)\\rho}}$，每个模式都可以求出 $E=12(1-\\nu^2)\\rho\\left(\\dfrac{2\\pi fL^2}{\\lambda h}\\right)^2$。各模式的结果相互一致，说明辨认的模式和频率参数是对的；若某个点明显偏离，多半是认错了图形（尤其是两个相邻编号的“转 90°”的一对）。</p>
      <div class="result-box">$E=${fmtU(Em, uE)}$ GPa（$u_A$ 由 ${A.length} 个模式的离散求出；板厚的仪器误差 0.004 mm 使 $E$ 有 ${pct((2 * uh) / hA)} 的 B 类不确定度）</div>
      <p>$f$–$\\lambda$ 应是过原点的直线：斜率 ${sl.toFixed(3)} Hz，由斜率得 $E$ = ${Es2.toFixed(1)} GPa。普通碳钢的杨氏模量约 200–210 GPa。</p>`;
    const answers = [{ label: '钢的杨氏模量 $E$', unit: 'GPa', value: Em, digits: 1, tolRel: 0.01 }];
    const lmax = Math.max(...A.map(lam)) * 1.08;
    const plots = [{ title: 'A 板：f – λ', xLabel: 'λ', yLabel: 'f / Hz', series: [{ type: 'scatter', data: A.map((r) => [lam(r), r.f]), label: 'A 板' }, ...(B.length ? [{ type: 'scatter', data: B.map((r) => [lam(r), r.f]), label: 'B 板' }] : []), { type: 'line', data: [[0, 0], [lmax, sl * lmax]], label: '过原点拟合（A）' }] }];
    const pairs = B.map((b) => ({ b, a: A.find((r) => Math.round(r.k) === Math.round(b.k)) })).filter((p) => p.a);
    if (pairs.length) {
      const ratios = pairs.map((p) => p.b.f / p.a.f), rm = mean(ratios);
      html += `<h3>2. 同一模式在两块板上的频率</h3><table><tr><th>编号</th><th>f_A/Hz</th><th>f_B/Hz</th><th>f_B/f_A</th></tr>${pairs.map((p, i) => `<tr><td>${Math.round(p.b.k)}</td><td>${p.a.f.toFixed(1)}</td><td>${p.b.f.toFixed(1)}</td><td>${ratios[i].toFixed(4)}</td></tr>`).join('')}</table>
        <div class="result-box">$\\overline{f_B/f_A}=${rm.toFixed(4)}$，厚度比 $h_B/h_A=${(hB / hA).toFixed(4)}$，相对偏差 ${pct(relErr(rm, hB / hA))}</div>
        <p>同一形状的板，$f\\propto\\dfrac{h}{L^2}\\sqrt{\\dfrac{E}{\\rho(1-\\nu^2)}}$：频率与厚度成正比、与边长的平方成反比。这就是乐器的音板、锣、钹做得越厚音越高的原因。</p>`;
      answers.push({ label: '$\\overline{f_B/f_A}$', unit: '', value: rm, digits: 4, tolRel: 0.003 });
    }
    const ks = [...new Set(A.map((r) => Math.round(r.k)))].sort((x, y) => x - y);
    if (ks.length >= 3) html += `<h3>3. 固有频率不是基频的整数倍</h3><p>A 板测到的共振频率与最低一个的比值：${A.slice().sort((x, y) => x.f - y.f).map((r, i, s) => (r.f / s[0].f).toFixed(2)).join('，')}。弦和管的泛音是基频的整数倍（谐音），板和膜的泛音不是，所以锣、钹、鼓的声音没有确定的音高。</p>`;
    return { html, ok: true, answers, plots };
  }

  principle() {
    const img = this._atlasURL ? `<p><img src="${this._atlasURL}" style="max-width:100%;border:1px solid #c9ced3" alt="振型图谱"></p>` : '';
    return `<h3>1. 薄板的弯曲振动</h3><p>厚度 $h$ 远小于边长 $L$ 的板作小振幅弯曲振动时，挠度 $w(x,y,t)$ 满足</p>$$D\\nabla^4w+\\rho h\\frac{\\partial^2w}{\\partial t^2}=0,\\qquad D=\\frac{Eh^3}{12(1-\\nu^2)}$$<p>$D$ 为板的抗弯刚度，$E$、$\\nu$、$\\rho$ 为材料的杨氏模量、泊松比和密度。在一定的支撑条件下它只有一系列分立的固有频率，每个频率对应一种振型。写成无量纲形式：</p>$$f_k=\\frac{\\lambda_k}{2\\pi L^2}\\sqrt{\\frac{D}{\\rho h}}$$<p>频率参数 $\\lambda_k$ 只取决于板的形状、支撑方式和泊松比，同一形状的板可以共用一张 λ 表。</p>
<h3>2. 克拉尼图形</h3><p>板在某个固有频率上共振时形成二维驻波，振幅为零的点连成节线。撒在板上的沙粒在振动大的地方被抛起（当地加速度幅值超过 g），落点随机；落到节线附近就不再被抛起，于是逐渐聚集成线。这一方法由 E. F. F. Chladni 在 1787 年提出。</p>
<h3>3. 振型图谱</h3>${img}<p>中心固定、四边自由的方板的前 ${ATLAS} 个模式。理想正方形板有很多成对的简并模式（形状相同、转过 90°）；实际的板总有微小的不对称，它们分裂成两个很近的共振频率。</p>
<h3>4. 本仿真的计算模型</h3><p>振型和 λ 用瑞利–里茨法计算：基函数取两个方向勒让德多项式之积（到 17 阶），四边自由的边界条件是能量泛函的自然边界条件；中心螺钉带垫圈（半径约 1 cm）：用罚函数约束中心挠度为零、垫圈范围内的平均转角为零（只约束中心一点的转角在薄板理论里不适定，结果会随多项式阶数一直变）。按 x、y 的奇偶性分成 4 块，用雅可比法求特征值。自由方板（不固定中心）的前几个 λ 为 13.47、19.60、24.27、34.80（ν = 0.3），与 A. W. Leissa 的 <i>Vibration of Plates</i>（NASA SP-160, 1969）表列值一致。</p><p>受迫振动按模式叠加：振动器使板中心作加速度幅值恒定的简谐运动，各模式的激励正比于振型在板面上的平均值，再加上代表板的不完善的小随机项；阻尼比约 0.004。</p>`;
  }
}
