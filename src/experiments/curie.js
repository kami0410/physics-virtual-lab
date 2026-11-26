// 实验：铁磁材料居里温度的测定（交流感应法）
// 铁氧体环形样品绕有初级、次级线圈，放在小加热炉中央；初级接 1 kHz 正弦信号，次级电压与样品的起始磁导率成正比（physics/curie.js）。
// 炉内铂电阻测的是炉膛温度，样品通过空气和瓷管受热，比炉温滞后（时间常数约 20 s）：升温时样品比读数低，降温时比读数高。
// 加热炉：热容 600 J/K，自然散热 0.25 W/K，开风扇 1.0 W/K，炉温超过 200 °C 时过温保护切断加热。
import * as THREE from 'three';
import { meta, thumb } from './curie.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox } from '../core/Models.js';
import { rand, clamp, relErr, pct } from '../core/Stats.js';
import { secondaryU, tangentTc } from '../physics/curie.js';

const CF = 600, H0 = 0.25, HFAN = 1.0, TAUS = 20, TMAX = 200;
const K0 = 273.15;

export class CurieExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    this.Ta = rand(18, 25);
    this.samples = [
      { name: '1 号样品（锰锌铁氧体）', Tc: rand(95, 110), U0: rand(42, 58), Ub: rand(0.2, 0.3) },
      { name: '2 号样品（镍锌铁氧体）', Tc: rand(135, 155), U0: rand(30, 42), Ub: rand(0.15, 0.25) },
    ];
    this.last = 0; this.power = false; this.heat = false; this.P = 0; this.fan = false;
    this.Tf = this.Ta; this.sT = [this.Ta, this.Ta]; this.t = 0; this.hold = null; this.timeScale = 1; // sT：两个样品各自的温度
  }
  /** 炉膛里的样品序号（没有为 -1）；si：表格、曲线用的样品（炉里没有时取最近放进去的那个） */
  get inOven() { const z = this.app.zones && this.app.zones.find((q) => q.id === 'ovenIn'); return z && z.occupant ? +z.occupant.key.slice(4) : -1; }
  get si() { const k = this.inOven; return k < 0 ? this.last : k; }
  get sample() { return this.samples[this.si]; }
  get Ts() { return this.sT[this.si]; }
  canRemove(comp) { if (comp.key.startsWith('ring') && +comp.key.slice(4) === this.inOven && this.Tf > 60) return `炉膛 ${this.Tf.toFixed(0)} °C，样品烫手拿不出来：开风扇等降到 60 °C 以下`; return null; }
  onPlace(c) { if (c && c.key.startsWith('ring') && this.inOven >= 0) this.last = this.inOven; this.app.renderInspector(); if (this.tBox) this.show(); this.app.changed(); }
  onSlotChange(c) { this.onPlace(c); }
  onRemove(c) { this.onPlace(c); }
  /** 自动操作：把 i 号样品放进炉膛（原来的放回台面） */
  async putSample(i) {
    const a = this.app, k = this.inOven;
    if (k === i) return;
    if (k >= 0) a.moveSlot(a.comp('ring' + k), 'rest' + k, { silent: true });
    await a.autoPut('ring' + i, 'ovenIn');
  }
  /** 炉温读数（°C，0.1） */
  readT() { return Math.round(this.Tf * 10) / 10; }
  /** 次级电压读数（mV，0.01） */
  readU() { const s = this.sample; return this.power && this.inOven >= 0 ? Math.round(secondaryU(this.Ts + K0, { Tc: s.Tc + K0, U0: s.U0, Ub: s.Ub, Tref: 298.15 }) * 100) / 100 : 0; }
  heating() { return this.heat && this.P > 0 && this.Tf < TMAX; }
  advance(T) {
    while (T > 1e-9) {
      if (this.hold) { const r = this.Tf; if ((this.hold.up && r >= this.hold.T) || (!this.hold.up && r <= this.hold.T)) return; }
      const h = Math.min(T, 1);
      if (this.Tf >= TMAX && this.heat) this.over = true;
      const P = this.heat && !this.over ? this.P : 0, hh = this.fan ? HFAN : H0;
      this.Tf += (h * (P - hh * (this.Tf - this.Ta))) / CF;
      if (this.over && this.Tf < TMAX - 10) this.over = false;
      const io = this.inOven;
      for (let k = 0; k < this.sT.length; k++) this.sT[k] += ((k === io ? this.Tf : this.Ta) - this.sT[k]) * (1 - Math.exp(-h / (k === io ? TAUS : 300))); // 炉外的样品在空气里慢慢冷却
      T -= h; this.t += h;
    }
  }
  tick(dt) {
    const a = this.app, sdt = Math.min(400, dt * (a.running ? a.speed * 40 : this.timeScale));
    const T0 = this.Tf; this.advance(sdt);
    if (Math.abs(this.Tf - T0) > 1e-6) this.show();
  }
  globalControls() { return [{ type: 'segment', label: '时间流速', get: () => this.timeScale, set: (v) => (this.timeScale = v), options: [{ label: '×1', value: 1 }, { label: '×10', value: 10 }, { label: '×30', value: 30 }, { label: '×60', value: 60 }] }]; }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [0, 60, 84], target: [0, 8, -6] }, { name: '仪器', pos: [16, 30, 32], target: [16, 7, -16] }, { name: '加热炉', pos: [-24, 30, 26], target: [-24, 10, -2] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(140, 86));
    app.stage.setLightTarget(0, 6, 0);
    // 加热炉
    const fg = new THREE.Group(); fg.position.set(-24, 0, -2);
    fg.add(mesh(new THREE.BoxGeometry(16, 2, 16), MAT.paint(0x3a3f44), 0, 1, 0));
    const shell = mesh(new THREE.CylinderGeometry(6.5, 6.5, 14, 40, 1, true), MAT.paint(0xc9c3b6), 0, 9, 0); shell.material.side = THREE.DoubleSide; fg.add(shell);
    fg.add(mesh(new THREE.CylinderGeometry(4.2, 4.2, 13.6, 32, 1, true), MAT.paint(0xe9e1cf), 0, 9, 0));
    const lid = new THREE.Mesh(new THREE.RingGeometry(4.2, 6.5, 40), MAT.paint(0x9c958a)); lid.rotation.x = -Math.PI / 2; lid.position.y = 16.01; fg.add(lid);
    // 两个环形样品（绕好初级、次级线圈）：从器材柜拿出来放进炉膛
    app.addSlot({ id: 'ovenIn', pos: new THREE.Vector3(-24, 13.6, -2), accepts: ['ring0', 'ring1'], label: '炉膛中央', r: 3, snap: 10 });
    this.samples.forEach((sm, i) => {
      app.addSlot({ id: 'rest' + i, pos: new THREE.Vector3(-40 + i * 8, 1, 18), accepts: ['ring' + i], label: '台面', r: 3, snap: 8 });
      const rg = new THREE.Group();
      const c = mesh(new THREE.TorusGeometry(2.2, 0.9, 16, 40), MAT.paint(i ? 0x3a3530 : 0x2a2a2a)); c.rotation.x = Math.PI / 2; rg.add(c);
      const w = mesh(new THREE.TorusGeometry(2.2, 1.0, 8, 40), new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.8, roughness: 0.35, wireframe: true })); w.rotation.x = Math.PI / 2; rg.add(w);
      app.addComponent(new Component({
        key: 'ring' + i, name: sm.name, zone: 'slot', defaultSlot: 'ovenIn', object: rg, labelY: 3,
        icon: '<svg viewBox="0 0 64 40"><circle cx="32" cy="20" r="11" fill="none" stroke="currentColor" stroke-width="5"/></svg>',
        desc: `${sm.name}，环形，外径约 20 mm，上面绕着初级、次级线圈，引线插在测试仪上。放进炉膛中央测量；炉温高时样品烫手，不能取出。刚放进热炉膛的样品要过一阵才跟上炉温。`,
      }));
    });
    this.hotRing = new THREE.Mesh(new THREE.RingGeometry(3.9, 4.2, 40), MAT.emissive(0xff5a1f, 0)); this.hotRing.rotation.x = -Math.PI / 2; this.hotRing.position.y = 15.9; fg.add(this.hotRing);
    this.fanG = new THREE.Group(); this.fanG.position.set(8.5, 4, 0);
    fg.add(mesh(new THREE.BoxGeometry(1.2, 5, 5), MAT.paint(0x2b3440), 8.2, 4, 0));
    for (let k = 0; k < 4; k++) { const b = mesh(new THREE.BoxGeometry(0.2, 2, 0.7), MAT.alu(), 0.5, 0, 0); b.rotation.x = (k * Math.PI) / 2; b.position.set(0.5, Math.cos((k * Math.PI) / 2), Math.sin((k * Math.PI) / 2)); this.fanG.add(b); }
    fg.add(this.fanG);
    app.addComponent(new Component({
      key: 'oven', name: '加热炉与样品', zone: 'none', fixed: true, required: true, object: fg, labelY: 22,
      icon: '<svg viewBox="0 0 64 40"><circle cx="32" cy="20" r="12" fill="none" stroke="currentColor" stroke-width="5"/><path d="M14 6h36v28H14z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
      desc: '小型管式加热炉，炉膛中央放环形铁氧体样品。铂电阻温度计测的是炉膛温度，不是样品温度。炉温超过 200 °C 时过温保护自动切断加热，降到 190 °C 以下恢复。',
      controls: () => [
        { type: 'readout', label: '炉膛里', get: () => (this.inOven < 0 ? '没有样品：从器材柜拿一个放进来' : this.samples[this.inOven].name) },
        { type: 'toggle', label: '加热', get: () => this.heat, set: (v) => { this.heat = v; app.changed(); } },
        { type: 'knob', label: '加热功率', get: () => this.P, set: (v) => { this.P = Math.round(clamp(v, 0, 60)); app.changed(); }, min: 0, max: 60, step: 1, bigStep: 5, perRev: 20, digits: 0, unit: 'W' },
        { type: 'toggle', label: '散热风扇', get: () => this.fan, set: (v) => { this.fan = v; app.changed(); } },
      ],
    }));
    // 测试仪
    const box = new THREE.Group(); box.position.set(16, 0, -16);
    box.add(mesh(new THREE.BoxGeometry(46, 12, 16), MAT.paint(0xd6d3cb), 0, 6, 0));
    const mt = (this.tBox = meterBox(18, 9, 1, '炉温')); mt.group.position.set(-11, 1.6, 7.6); box.add(mt.group);
    const mu = (this.uBox = meterBox(18, 9, 1, '次级电压')); mu.group.position.set(11, 1.6, 7.6); box.add(mu.group);
    this.led = mesh(new THREE.SphereGeometry(0.5, 12, 8), MAT.emissive(0x22c55e, 0), -21, 10, 8.2); box.add(this.led);
    app.addComponent(new Component({
      key: 'meter', name: '居里温度测试仪', zone: 'none', fixed: true, object: box, labelY: 16,
      desc: '内含 1 kHz 正弦信号源（给初级线圈供电）、交流毫伏表（测次级电压，分辨 0.01 mV）和铂电阻数字温度计（分辨 0.1 °C）。',
      controls: () => [
        { type: 'toggle', label: '电源', get: () => this.power, set: (v) => { this.power = v; app.changed(); } },
        { type: 'readout', label: '炉温', get: () => `${this.readT().toFixed(1)} °C` },
        { type: 'readout', label: '次级电压', get: () => (!this.power ? '电源未开' : this.inOven < 0 ? '炉膛里没有样品（线圈没接上）' : `${this.readU().toFixed(2)} mV`) },
      ],
    }));
    this.cv = app.addView({ id: 'ut', title: '次级电压–炉温（已记录的点）', w: 300, h: 200, res: 1.6 });
  }
  show() {
    const sT = this.readT().toFixed(1), sU = this.power ? this.readU().toFixed(2) : '';
    const st = this.over ? '过温保护' : this.heating() ? `加热 ${this.P} W` : this.fan ? '风扇散热' : '自然冷却';
    let dirty = false;
    if (sT + st !== this._sT) { this._sT = sT + st; this.tBox.setText(sT, '°C', st); dirty = true; }
    if (sU !== this._sU) { this._sU = sU; this.uBox.setText(sU, this.power ? 'mV' : '', this.power ? '1 kHz' : ''); dirty = true; }
    this.hotRing.material.emissiveIntensity = clamp((this.Tf - 60) / 140, 0, 1) * 1.4;
    this.led.material.emissiveIntensity = this.power ? 1.6 : 0;
    if (dirty || this._si !== this.si) { this._si = this.si; this.drawChart(); }
  }
  update() { this._sT = null; this.show(); }
  drawChart() {
    const v = this.cv; if (!v) return;
    const g = v.ctx, W = v.W, H = v.H, s = this.sample;
    const x0 = W * 0.13, x1 = W * 0.96, y0 = H * 0.86, y1 = H * 0.08, Tmax = s.Tc > 120 ? 180 : 140, Umax = Math.ceil((s.U0 * 1.12) / 10) * 10;
    const X = (T) => x0 + ((T - 20) / (Tmax - 20)) * (x1 - x0), Y = (U) => y0 - (U / Umax) * (y0 - y1);
    g.fillStyle = '#f7f5f0'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#d9d4c9'; g.lineWidth = 1;
    g.font = `${H * 0.055}px "IBM Plex Mono", Consolas, monospace`; g.fillStyle = '#5b6670'; g.textAlign = 'center';
    for (let T = 20; T <= Tmax; T += 20) { g.beginPath(); g.moveTo(X(T), y0); g.lineTo(X(T), y1); g.stroke(); g.fillText(String(T), X(T), y0 + H * 0.07); }
    g.textAlign = 'right';
    for (let U = 0; U <= Umax; U += 10) { g.beginPath(); g.moveTo(x0, Y(U)); g.lineTo(x1, Y(U)); g.stroke(); g.fillText(String(U), x0 - 4, Y(U) + 4); }
    g.strokeStyle = '#4b5963'; g.beginPath(); g.moveTo(x0, y1); g.lineTo(x0, y0); g.lineTo(x1, y0); g.stroke();
    const dot = (T, U, c) => { g.fillStyle = c; g.beginPath(); g.arc(X(T), Y(U), H * 0.016, 0, 7); g.fill(); };
    const rows = (id) => (this.app.table(id)?.rows || []).filter((r) => typeof r.T === 'number' && typeof r.U === 'number' && r._s === this.si);
    for (const r of rows('heat')) dot(r.T, r.U, '#b23a2a');
    for (const r of rows('cool')) dot(r.T, r.U, '#1f4e79');
    if (this.power && this.readT() <= Tmax) { g.strokeStyle = '#111'; g.lineWidth = 1.5; const x = X(this.readT()), y = Y(this.readU()); g.beginPath(); g.moveTo(x - 5, y); g.lineTo(x + 5, y); g.moveTo(x, y - 5); g.lineTo(x, y + 5); g.stroke(); }
    v.foot(`${s.name}　红：升温　蓝：降温　+：当前读数`);
  }

  // ======================= 数据表 =======================
  tables() {
    const cols = [{ key: 'T', label: '炉温 T/°C', digits: 1, readTol: 0.1 }, { key: 'U', label: '次级电压 U/mV', digits: 2, readTol: (r) => 0.003 * r + 0.02 }];
    return [
      { id: 'heat', title: '升温过程', maxRows: 40, columns: cols, buttons: [{ label: '记录炉温与次级电压', onClick: (t) => this.rec(t, true) }], note: '加热功率 1 号样品约 30 W、2 号样品约 45 W，使居里点附近的升温速率不超过约 2 °C/min。低温段每 10 °C 记一次，次级电压开始明显下降后每 2–3 °C 记一次，一直测到电压不再变化。' },
      { id: 'cool', title: '降温过程', maxRows: 40, columns: cols, buttons: [{ label: '记录炉温与次级电压', onClick: (t) => this.rec(t, false) }], note: '关掉加热，让炉子自然冷却（居里点附近不要开风扇，降温太快样品温度跟不上）。在电压回升的一段每 2–3 °C 记一次。' },
    ];
  }
  rec(t, up) {
    const a = this.app, T = this.readT(), U = this.readU();
    if (!this.power) return a.toast('测试仪电源没开', 'warn');
    if (t.rows.some((r) => Math.abs(r.T - T) < 0.5)) a.toast('这个温度附近已经记过了', 'warn');
    const fl = [];
    if (up && !this.heating()) fl.push('这张是升温曲线，但现在没有在加热');
    if (!up && this.heat) fl.push('这张是降温曲线，但加热还开着');
    if (t.rows.length && t.rows[0]._s !== this.si) fl.push('这张表前面记的是另一个样品');
    t.flagAll(t.addRow({ T, U, _s: this.si }), fl);
    this.drawChart();
  }

  // ======================= 自动操作 =======================
  async flag(key, v) { const a = this.app; a.select(a.comp(key === 'power' ? 'meter' : 'oven')); this[key] = v; a.renderInspector(); a.changed(); await a.wait(120); }
  async knob(to) { const a = this.app; a.select(a.comp('oven')); await a.tween(() => this.P, (v) => (this.P = v), to, 300); this.P = to; a.changed(); await a.wait(80); }
  /** 炉温到达 T 时停住，记一个点 */
  async recAt(id, T, up) {
    const a = this.app, rows = a.table(id).rows;
    if (rows.some((r) => Math.abs(r.T - T) < 1)) return;
    if ((up && this.Tf > T + 0.5) || (!up && this.Tf < T - 0.5)) return;
    this.hold = { T, up };
    try { await a.until(() => (up ? this.Tf >= T : this.Tf <= T), 90000); await a.record(id, 0); } finally { this.hold = null; }
  }
  targets(up) {
    const Tc = this.sample.Tc, lo = [], hi = [];
    for (let T = 30; T < Tc - 22; T += 10) lo.push(T);
    for (let T = Math.round(Tc - 22); T <= Tc + 12; T += 3) hi.push(T);
    return up ? [...lo, ...hi] : [...hi.reverse(), ...[...lo].reverse().filter((T) => T < Tc - 22 && T > Tc - 45)];
  }
  steps() {
    const app = this.app, rows = (id) => app.table(id).completeRows().filter((r) => r._s === this.si);
    const curveOK = (id) => { const r = rows(id); if (r.length < 10) return false; const m = Math.max(...r.map((x) => x.U)); return r.some((x) => x.U < 0.05 * m) && r.filter((x) => x.U > 0.1 * m && x.U < 0.8 * m).length >= 3; };
    const say = (id) => { const r = rows(id); return r.length ? `已记录 ${r.length} 点，${Math.min(...r.map((x) => x.T)).toFixed(1)}–${Math.max(...r.map((x) => x.T)).toFixed(1)} °C` : '还没有记录'; };
    return [
      {
        title: '接通测试仪',
        html: '<p>从器材柜拿一个样品<b>拖进加热炉的炉膛</b>，打开居里温度测试仪的电源。室温下记下次级电压的大小。</p>',
        check: () => this.power && this.inOven >= 0,
        auto: async () => { await app.view('全景'); if (this.inOven < 0) await this.putSample(this.last); await this.flag('power', true); },
      },
      {
        title: '升温测量',
        html: '<p>打开加热，功率调到 30 W（2 号样品 45 W），使炉温缓慢上升（居里点附近不超过约 2 °C/min）。低温段每 10 °C 记一次炉温和次级电压；电压开始迅速下降后每 2–3 °C 记一次，直到电压降到很小、不再变化。</p>',
        hint: '升温太快时样品温度跟不上炉温，测得的居里温度偏高。观察右上角的记录图。',
        status: () => say('heat'),
        check: () => curveOK('heat'),
        diagnose: () => (!this.power ? [{ msg: '测试仪电源没开。', fix: { label: '打开', run: async () => { this.power = true; } } }] : !this.heating() && !this.over ? [{ msg: '加热没有打开，或功率为 0。', fix: { label: '打开加热', run: async () => { this.heat = true; this.P = this.sample.Tc > 120 ? 45 : 32; this.fan = false; } } }] : []),
        auto: async () => {
          app.showTable(0); await app.view('仪器');
          if (this.inOven < 0) await this.putSample(this.last);
          if (!this.power) await this.flag('power', true);
          if (this.fan) await this.flag('fan', false);
          await this.flag('heat', true); await this.knob(this.sample.Tc > 120 ? 45 : 32);
          for (const T of this.targets(true)) await this.recAt('heat', T, true);
        },
      },
      {
        title: '降温测量',
        html: '<p>关掉加热，让炉子自然冷却。电压回升的一段每 2–3 °C 记一次，直到低于居里点 20 °C 以上。</p>',
        hint: '居里点附近不要开风扇：降温越快，样品温度越高于炉温读数，测得的居里温度越偏低。',
        status: () => say('cool'),
        check: () => curveOK('cool'),
        diagnose: () => (this.heat ? [{ msg: '加热还开着。', fix: { label: '关掉', run: async () => { this.heat = false; } } }] : !this.power ? [{ msg: '测试仪电源没开。', fix: { label: '打开', run: async () => { this.power = true; } } }] : []),
        auto: async () => {
          app.showTable(1); await app.view('仪器');
          if (this.inOven < 0) await this.putSample(this.last);
          if (!this.power) await this.flag('power', true);
          // 还没升到居里点以上时先加热上去
          const top = this.sample.Tc + 13;
          if (this.Tf < top && !rows('cool').length) {
            await this.flag('heat', true); if (this.P < 20) await this.knob(this.sample.Tc > 120 ? 45 : 32);
            this.hold = { T: top, up: true };
            try { await app.until(() => this.Tf >= top, 90000); } finally { this.hold = null; }
          }
          await this.flag('heat', false); if (this.fan) await this.flag('fan', false);
          for (const T of this.targets(false)) await this.recAt('cool', T, false);
        },
      },
      {
        title: '数据处理',
        html: '<p>在同一张图上作升温、降温两条 $U$–$T$ 曲线。在每条曲线最陡的一段作切线，切线与温度轴的交点即为居里温度；两者取平均。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app, si = (a.table('heat').completeRows()[0] ?? a.table('cool').completeRows()[0])?._s ?? this.si, s = this.samples[si];
    const get = (id) => a.table(id).completeRows().filter((r) => r._s === si).map((r) => [r.T, r.U]);
    const H = get('heat'), C = get('cool');
    if (H.length < 5 && C.length < 5) return { html: '<p>请先在升温或降温过程中记录至少 5 个点（包括电压迅速下降的一段）。</p>', ok: false };
    const fh = H.length >= 5 ? tangentTc(H) : null, fc = C.length >= 5 ? tangentTc(C) : null;
    const line = (name, f) => (f ? `<p>${name}：最陡的一段是 ${f.seg.map((p) => `${p[0].toFixed(1)} °C`).join("、")} 这几点，拟合切线 $U=${f.k.toFixed(3)}\\,T+${f.b.toFixed(2)}$（mV），与 $T$ 轴交于 <b>${f.Tc.toFixed(1)} °C</b>。</p>` : `<p>${name}：数据不足。</p>`);
    const Tcs = [fh, fc].filter(Boolean).map((f) => f.Tc), Tc = Tcs.reduce((x, y) => x + y, 0) / Tcs.length, err = relErr(Tc, s.Tc);
    let html = `<h3>1. U–T 曲线与切线法</h3><p>${s.name}。温度升到居里点附近，自发磁化强度迅速减小到零，起始磁导率随之急剧下降，次级电压在一个不大的温度区间内从几十毫伏降到零点几毫伏。</p>${line('升温曲线', fh)}${line('降温曲线', fc)}`;
    if (fh && fc) html += `<p>升温曲线的交点比降温曲线高 ${(fh.Tc - fc.Tc).toFixed(1)} °C：温度计测的是炉膛温度，样品受热有滞后——升温时样品温度低于读数，降温时高于读数。两者平均可以基本抵消这一误差。</p>`;
    html += `<div class="result-box">居里温度 $T_C=${Tc.toFixed(1)}$ °C（${(Tc + K0).toFixed(1)} K）</div>
      <p>本样品的标称居里温度 ${s.Tc.toFixed(1)} °C，相对误差 ${pct(err)}（按摄氏温度计算）。</p>
      <p>切线法把曲线下降段近似为直线：分子场理论中，接近居里点时 $M_s^2\\propto(T_C-T)$，起始磁导率的变化也近似线性，所以切线与温度轴的交点接近 $T_C$。居里点以上仍有很小的电压：一部分是线圈之间的空气耦合，一部分是顺磁性的磁化率 $\\chi=C/(T-\\theta)$。</p>`;
    const plots = [{ title: '次级电压 U – 炉温 T', xLabel: 'T / °C', yLabel: 'U / mV', series: [
      ...(H.length ? [{ type: 'scatter', data: H, label: '升温' }] : []), ...(C.length ? [{ type: 'scatter', data: C, label: '降温' }] : []),
      ...[fh, fc].filter(Boolean).map((f, i) => ({ type: 'line', data: [[f.seg[0][0] - 8, f.k * (f.seg[0][0] - 8) + f.b], [f.Tc, 0]], label: i ? '' : '切线' })),
    ] }];
    return { html, ok: true, answers: [{ label: '居里温度 $T_C$', unit: '°C', value: Tc, digits: 1, tolAbs: 1 }], plots };
  }

  principle() {
    return `<h3>1. 铁磁性与居里温度</h3><p>铁磁性物质内部存在自发磁化的磁畴，相邻原子磁矩在交换作用下平行排列。温度升高，热运动破坏这种有序排列，自发磁化强度 $M_s$ 逐渐减小；到某一温度 $T_C$ 时 $M_s=0$，物质由铁磁性转变为顺磁性，这一温度叫居里温度（居里点）。按外斯分子场理论，约化磁化强度 $m=M_s/M_0$ 满足</p>$$m=\\tanh\\frac{m}{t},\\qquad t=\\frac{T}{T_C}$$<p>$t\\to1$ 时 $m^2\\approx3(1-t)$。居里点以上，磁化率服从居里–外斯定律 $\\chi=C/(T-\\theta)$。</p>
<h3>2. 交流感应法</h3><p>在环形样品上绕初级、次级两组线圈，初级通以频率、幅度一定的交流电流 $i_1$，样品中的磁感应强度 $B=\\mu H\\propto\\mu i_1$，次级感应电动势</p>$$U_2=N_2S\\frac{dB}{dt}\\propto\\mu$$<p>所以次级电压的变化反映了样品磁导率随温度的变化。在居里点附近 $\\mu$ 急剧下降，$U_2$ 随之迅速减小。</p>
<h3>3. 切线法</h3><p>作 $U_2$–$T$ 曲线，在下降最陡的一段作切线，与温度轴的交点即为居里温度。为了减小样品温度滞后的影响，分别在升温和降温过程中测量，取两者的平均。</p>
<h3>4. 本仿真的计算模型</h3><p>磁导率的温度因子取 $m^2(1+2t^6)$，$m$ 由上面的分子场方程用牛顿法求出；居里点以上加一小段顺磁尾巴和空气耦合的本底电压。加热炉按集中热容计算（热容 ${CF} J/K，散热系数 ${H0} W/K，开风扇 ${HFAN} W/K），样品温度以 ${TAUS} s 的时间常数跟随炉温。两个样品的居里温度个体随机（1 号 95–110 °C，2 号 135–155 °C）。</p>`;
  }
}
