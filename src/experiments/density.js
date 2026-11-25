// 实验：长度测量与固体密度（游标卡尺 + 螺旋测微器 + 电子天平）
// 被测物：空心铜圆柱（外径 D、内径 d、高 H 用游标卡尺）与小钢球（直径用螺旋测微器）。
// 工件不是理想几何体：不同位置、不同方向的尺寸有几微米到十几微米的差别，所以要多处测量取平均。
// 量具读数窗由 core/gauges.js 绘制，学生自己读；游标卡尺、螺旋测微器各有零点误差，电子天平开机后有一点零漂，要先置零。
import * as THREE from 'three';
import { meta, thumb } from './density.meta.js';
import { benchTable } from '../core/circuit.js';
import { Component } from '../core/Component.js';
import { MAT, mesh, meterBox } from '../core/Models.js';
import { Micrometer, Caliper } from '../core/gauges.js';
import { rand, gauss, clamp, mean, stdev, uA, fmtU, relErr, pct } from '../core/Stats.js';

const N = 6;
const D_CAL = 0.02, D_MIC = 0.004, D_BAL = 0.02; // 仪器最大允差：游标卡尺 0.02 mm，一级千分尺 0.004 mm，电子天平 0.02 g
const FEATS = { z: '合拢读零点', D: '外径 D', d: '内径 d（内量爪）', H: '高 H' };
const SVG = (inner) => `<svg viewBox="0 0 64 40" fill="none" stroke="currentColor" stroke-width="1.5">${inner}</svg>`;

export class DensityExperiment {
  static meta = meta;

  static thumb = thumb;

  constructor(app) {
    this.app = app;
    // 空心铜圆柱：每个尺寸在 6 个测量位置上的真实值（mm），带一点锥度与椭圆度
    this.rhoC = rand(8.43, 8.55); this.rhoB = rand(7.80, 7.86);
    const D0 = rand(34, 38), d0 = rand(20, 24), H0 = rand(42, 48), taper = rand(-0.012, 0.012);
    this.dims = {
      D: Array.from({ length: N }, (_, i) => D0 + taper * (i / (N - 1) - 0.5) + gauss(0.006)),
      d: Array.from({ length: N }, (_, i) => d0 - taper * 0.6 * (i / (N - 1) - 0.5) + gauss(0.006)),
      H: Array.from({ length: N }, () => H0 + gauss(0.008)),
    };
    const db0 = rand(9.5, 12.7);
    this.balls = Array.from({ length: N }, () => db0 + gauss(0.0012));
    const D = mean(this.dims.D), d = mean(this.dims.d), H = mean(this.dims.H);
    this.mC = (this.rhoC * Math.PI * (D * D - d * d) * H) / 4 / 1000; // g
    this.mB = (this.rhoB * Math.PI * db0 ** 3) / 6 / 1000;
    this.cal = new Caliper({ zero: [0, 0.02, -0.02, 0.04][Math.floor(Math.random() * 4)] });
    this.mic = new Micrometer({ zero: Math.round(rand(-10, 12)) / 1000 || 0.004 });
    this.cal.open = 12; this.mic.gap = 3;
    this.tool = 'cal'; this.feat = 'z'; this.micAt = 'z';
    this.balOff = Math.round(rand(2, 8)) / 100; this.pan = null; this.assist = false;
  }

  // ---------- 游标卡尺：外量爪夹工件时开口不能小于工件，内量爪撑内壁时开口不能大于内径 ----------
  nextRow(id, k) { const i = this.app.table(id)?.rows.findIndex((r) => !(r[k] != null && r[k] !== '' && isFinite(r[k]))); return i == null || i < 0 ? N - 1 : i; }
  calSize() { return this.feat === 'z' ? null : this.dims[this.feat][this.nextRow('cyl', this.feat)]; }
  setFeat(f) {
    this.feat = f; this.tool = 'cal';
    const s = this.calSize();
    if (f === 'd') { this.cal.obj = null; this.cal.open = Math.min(this.cal.open, s - 3); }
    else this.cal.setObject(s);
    this.app.changed();
  }
  calPush(v) {
    this.tool = 'cal';
    if (this.feat === 'd') this.cal.open = clamp(v, 0, this.calSize());
    else { this.cal.obj = this.calSize(); this.cal.push(v); }
  }
  calProblem() {
    const s = this.calSize();
    if (this.feat === 'z') return this.cal.open > 0.01 ? '两量爪没有合拢' : null;
    if (this.feat === 'd') return this.cal.open < s - 1e-9 ? '内量爪还没有撑到内壁' : null;
    return this.cal.open > s + 1e-9 ? '量爪还没有贴紧工件' : null;
  }
  get calRead() { return Math.round(this.cal.reading / 0.02) * 0.02; }
  setMic(at) {
    this.micAt = at; this.tool = 'mic';
    this.mic.setObject(at === 'z' ? null : this.balls[this.nextRow('ball', 'r')]);
    this.app.changed();
  }
  get balShow() { return Math.round(((this.pan === 'cyl' ? this.mC : this.pan === 'ball' ? this.mB : 0) + this.balOff) * 100) / 100; }

  // ======================= 场景 =======================
  cameras() { return [{ name: '全景', pos: [0, 62, 78], target: [0, 4, 0] }, { name: '量具', pos: [-6, 34, 40], target: [-6, 3, 0] }]; }
  build() {
    const app = this.app, scene = app.stage.scene;
    scene.add(benchTable(130, 64));
    app.stage.setLightTarget(0, 4, 0);
    // 游标卡尺（尺身 + 可动尺框），开口 1 mm 对应 0.15 场景单位
    const cal = new THREE.Group(); cal.position.set(-30, 0.6, 10);
    cal.add(mesh(new THREE.BoxGeometry(34, 0.3, 2.2), MAT.chrome(), 8, 0, 0));
    cal.add(mesh(new THREE.BoxGeometry(1.4, 0.3, 6), MAT.chrome(), -8.5, 0, -2.6));
    this.calJaw = new THREE.Group(); this.calJaw.add(mesh(new THREE.BoxGeometry(5, 0.5, 3), MAT.alu(), 1.8, 0.1, 0), mesh(new THREE.BoxGeometry(1.4, 0.3, 6), MAT.chrome(), 0, 0, -2.6));
    cal.add(this.calJaw);
    app.addComponent(new Component({
      key: 'cal', name: '游标卡尺（50 分度）', zone: 'none', fixed: true, object: cal, labelY: 4,
      icon: SVG('<path d="M4 14h56v6H4z"/><path d="M8 14V4h4v10M22 20v10h4V20"/><path d="M20 14h12v6H20"/>'),
      desc: '量程 0–150 mm，游标 50 格对应主尺 49 mm，分度值 0.02 mm，不估读。外量爪测外径和高，内量爪测内径。用前先合拢读零点，测量值 = 读数 − 零点读数。',
      controls: () => [
        { type: 'select', label: '测量', get: () => this.feat, set: (v) => { this.setFeat(v); app.renderInspector(); }, options: Object.entries(FEATS).map(([value, label]) => ({ label, value })) },
        { type: 'knob', label: this.feat === 'd' ? '拉开尺框' : '推动尺框', get: () => this.cal.open, set: (v) => { this.calPush(v); app.changed(); }, min: 0, max: 150, step: 0.02, bigStep: 1, perRev: 10, digits: 2, unit: 'mm', fmt: () => (this.calProblem() ? '移动尺框' : '已贴紧') },
        { type: 'readout', label: '位置', get: () => (this.feat === 'z' ? '—' : `第 ${this.nextRow('cyl', this.feat) + 1} 处`) },
      ],
    }));
    // 螺旋测微器：C 形尺架 + 测砧 + 测杆 + 微分筒
    const mic = new THREE.Group(); mic.position.set(8, 0, 14);
    const arc = mesh(new THREE.TorusGeometry(3.4, 0.55, 10, 30, Math.PI), MAT.paint(0x2c4a6b), 0, 3.6, 0); arc.rotation.z = Math.PI / 2; mic.add(arc);
    mic.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.4, 12), MAT.chrome(), -1.2, 0.2, 0).rotateZ(Math.PI / 2));
    this.micSpindle = new THREE.Group(); this.micSpindle.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 3, 12), MAT.chrome(), 1.5, 0, 0).rotateZ(Math.PI / 2), mesh(new THREE.CylinderGeometry(0.75, 0.75, 4.2, 24), MAT.chrome(), 5.2, 0, 0).rotateZ(Math.PI / 2), mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.4, 16), MAT.black(), 8, 0, 0).rotateZ(Math.PI / 2));
    this.micSpindle.position.set(0, 0.2, 0); mic.add(this.micSpindle);
    mic.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 3, 16), MAT.alu(), 3.2, 0.2, 0).rotateZ(Math.PI / 2));
    app.addComponent(new Component({
      key: 'mic', name: '螺旋测微器（千分尺）', zone: 'none', fixed: true, object: mic, labelY: 9,
      icon: SVG('<path d="M10 30a12 12 0 0 1 0-22"/><path d="M10 8h8M10 30h8"/><rect x="24" y="15" width="22" height="8"/><path d="M46 17h10v4H46"/>'),
      desc: '量程 0–25 mm，螺距 0.5 mm，微分筒 50 格，分度值 0.01 mm，要估读到 0.001 mm。测砧接近工件时改用测力装置（棘轮），听到“咔咔”声即停。用前先读零点（可正可负）。',
      controls: () => [
        { type: 'segment', label: '测量', get: () => this.micAt, set: (v) => { this.setMic(v); app.renderInspector(); }, options: [{ label: '零点', value: 'z' }, { label: '钢球直径', value: 'b' }] },
        ...this.mic.controls(() => { this.tool = 'mic'; app.changed(); }),
        { type: 'readout', label: '位置', get: () => (this.micAt === 'z' ? '—' : `第 ${this.nextRow('ball', 'r') + 1} 次（每次转动钢球换一个方向）`) },
      ],
    }));
    // 电子天平
    const bal = new THREE.Group(); bal.position.set(34, 0, 2);
    bal.add(mesh(new THREE.BoxGeometry(16, 3, 18), MAT.paint(0xe8e8e2), 0, 1.5, 0));
    bal.add(mesh(new THREE.CylinderGeometry(5.5, 5.5, 0.4, 40), MAT.chrome(), 0, 3.4, -1.5));
    const disp = (this.balBox = meterBox(10, 3.2, 2, '电子天平')); disp.group.position.set(0, 1.4, 8.6); disp.group.scale.setScalar(0.7); bal.add(disp.group);
    app.addComponent(new Component({
      key: 'bal', name: '电子天平', zone: 'none', fixed: true, object: bal, labelY: 8,
      icon: SVG('<rect x="8" y="22" width="48" height="12" rx="2"/><path d="M14 18h36"/><rect x="24" y="26" width="16" height="5"/>'),
      desc: '最大称量 200 g，分度值 0.01 g，最大允差按 0.02 g 计。开机后秤盘上没有东西时示数不一定是 0，要先按“置零”。',
      controls: () => [
        { type: 'segment', label: '秤盘上', get: () => this.pan ?? 'none', set: (v) => { this.pan = v === 'none' ? null : v; this.tool = 'bal'; app.changed(); }, options: [{ label: '空', value: 'none' }, { label: '空心圆柱', value: 'cyl' }, { label: '钢球', value: 'ball' }] },
        { type: 'button', label: '置零', onClick: () => this.tare() },
        { type: 'readout', label: '示数', get: () => `${this.balShow.toFixed(2)} g` },
      ],
    }));
    // 被测物
    const cyl = (this.cylObj = new THREE.Group());
    const brass = MAT.brass(), sc = 0.15;
    const R = (mean(this.dims.D) / 2) * sc, r = (mean(this.dims.d) / 2) * sc, h = mean(this.dims.H) * sc;
    cyl.add(mesh(new THREE.CylinderGeometry(R, R, h, 40, 1, true), brass, 0, h / 2, 0));
    const inner = new THREE.MeshStandardMaterial({ color: 0x8a6a2a, metalness: 0.8, roughness: 0.4, side: THREE.BackSide });
    cyl.add(mesh(new THREE.CylinderGeometry(r, r, h, 40, 1, true), inner, 0, h / 2, 0));
    const cap = new THREE.RingGeometry(r, R, 40); cap.rotateX(-Math.PI / 2);
    cyl.add(mesh(cap, brass, 0, h, 0)); const cap2 = cap.clone(); cap2.rotateX(Math.PI); cyl.add(mesh(cap2, brass, 0, 0.01, 0));
    scene.add(cyl);
    this.ballObj = mesh(new THREE.SphereGeometry(this.balls[0] * sc * 0.75, 24, 16), MAT.chrome());
    scene.add(this.ballObj);
    this.view = app.addView({ id: 'gauge', title: '读数窗', w: 320, h: 150, res: 2 });
  }

  tare() {
    const a = this.app; this.tool = 'bal';
    if (this.pan) { a.toast('秤盘上放着东西时置零，相当于把它的质量扣掉了：应先拿下来再置零', 'warn'); this.balOff = -(this.pan === 'cyl' ? this.mC : this.mB); }
    else this.balOff = 0;
    a.changed();
  }

  update() {
    // 被测物放到正在使用的量具上
    const onCal = this.tool === 'cal' && this.feat !== 'z', onMic = this.tool === 'mic' && this.micAt === 'b';
    this.cylObj.position.set(...(this.pan === 'cyl' ? [34, 3.6, 0.5] : onCal ? [-24, 0.9, 4] : [-6, 0, -8]));
    this.ballObj.position.set(...(this.pan === 'ball' ? [34, 4.4, -1.5] : onMic ? [7.6, 0.4, 14] : [4, 1.3, -8]));
    this.calJaw.position.x = -6.5 + clamp(this.cal.open, 0, 150) * 0.15;
    this.micSpindle.position.x = clamp(this.mic.gap, 0, 25) * 0.12 - 0.5;
    const b = this.balShow.toFixed(2);
    if (b !== this._b) { this._b = b; this.balBox.setText(b, 'g', '电子天平'); }

    const v = this.view, g = v.ctx, W = v.W, H = v.H;
    if (this.tool === 'cal') {
      this.cal.draw(g, W, H, { assist: this.assist });
      const p = this.calProblem();
      v.foot(`游标卡尺 · ${FEATS[this.feat]}${p ? ' —— ' + p : ' —— 看游标上哪一条刻线与主尺刻线对齐'}`);
    } else if (this.tool === 'mic') {
      this.mic.draw(g, W, H, { assist: this.assist });
      const p = this.mic.problem();
      v.foot(`螺旋测微器 · ${this.micAt === 'z' ? '零点' : '钢球直径'}${p ? ' —— ' + p : ' —— 先读套管上露出的毫米与半毫米，再读微分筒格数并估读一位'}`);
    } else {
      g.fillStyle = '#20262b'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#0b1410'; g.fillRect(W * 0.12, H * 0.22, W * 0.76, H * 0.46);
      g.fillStyle = '#8fe3a5'; g.font = `600 ${H * 0.32}px "IBM Plex Mono", monospace`; g.textAlign = 'right';
      g.fillText(this.balShow.toFixed(2), W * 0.78, H * 0.58);
      g.fillStyle = '#7d8a90'; g.font = `${H * 0.12}px "IBM Plex Mono", monospace`; g.textAlign = 'left'; g.fillText('g', W * 0.8, H * 0.58);
      v.foot(this.pan ? `秤盘上：${this.pan === 'cyl' ? '空心圆柱' : '钢球'}` : Math.abs(this.balOff) > 0.004 ? '秤盘是空的，示数却不是 0：先按“置零”' : '秤盘是空的，示数为 0');
    }
  }
  globalControls() {
    return [
      { type: 'segment', label: '读数窗显示', get: () => this.tool, set: (v) => { this.tool = v; this.app.changed(); }, options: [{ label: '游标卡尺', value: 'cal' }, { label: '螺旋测微器', value: 'mic' }, { label: '天平', value: 'bal' }] },
      { type: 'toggle', label: '读数辅助（显示数值）', get: () => this.assist, set: (v) => (this.assist = v) },
    ];
  }

  // ======================= 数据表 =======================
  tables() {
    return [
      {
        id: 'zero', title: '零点读数', fixedRows: true,
        initRows: () => [{ q: 'cal', what: '游标卡尺 / mm' }, { q: 'mic', what: '螺旋测微器 / mm' }],
        columns: [{ key: 'what', label: '量具', type: 'text', readonly: true }, { key: 'v', label: '零点读数', digits: 3, readTol: 0.0025 }],
        buttons: [{ label: '记录当前量具的零点', onClick: (t) => this.recZero(t) }],
        note: '游标卡尺两量爪合拢、螺旋测微器测砧与测杆刚好接触（用棘轮）时的读数。零线在主尺 0 线右边为正，左边为负。',
      },
      {
        id: 'cyl', title: '空心圆柱（游标卡尺）', fixedRows: true,
        initRows: () => Array.from({ length: N }, (_, i) => ({ i: i + 1 })),
        columns: [
          { key: 'i', label: '次数', digits: 0, readonly: true },
          { key: 'D', label: '外径读数/mm', digits: 2, readTol: 0.011 },
          { key: 'd', label: '内径读数/mm', digits: 2, readTol: 0.011 },
          { key: 'H', label: '高读数/mm', digits: 2, readTol: 0.011 },
        ],
        buttons: [{ label: '记录卡尺读数', onClick: (t) => this.recCyl(t) }],
        note: '外径、内径在圆柱的上、中、下不同位置和不同方向测，高在端面不同位置测，各 6 次。每记一次，工件换一个位置，量爪要重新夹紧。',
      },
      {
        id: 'ball', title: '钢球直径（螺旋测微器）', fixedRows: true,
        initRows: () => Array.from({ length: N }, (_, i) => ({ i: i + 1 })),
        columns: [{ key: 'i', label: '次数', digits: 0, readonly: true }, { key: 'r', label: '读数/mm', digits: 3, readTol: 0.0025 }],
        buttons: [{ label: '记录千分尺读数', onClick: (t) => this.recBall(t) }],
        note: '每次把钢球转一个方向再测，共 6 次。读数要估读到 0.001 mm。',
      },
      {
        id: 'mass', title: '质量（电子天平）', fixedRows: true,
        initRows: () => [{ q: 'cyl', what: '空心圆柱 m₁ / g' }, { q: 'ball', what: '钢球 m₂ / g' }],
        columns: [{ key: 'what', label: '被测物', type: 'text', readonly: true }, { key: 'm', label: '质量', digits: 2, readTol: 0.006 }],
        buttons: [{ label: '记录天平示数', onClick: (t) => this.recMass(t) }],
        note: '先在秤盘空着时按“置零”，再放上被测物，示数稳定后记录。',
      },
    ];
  }
  recZero(t) {
    const a = this.app;
    if (this.tool === 'cal') {
      if (this.feat !== 'z') return a.toast('读零点要先选“合拢读零点”，把两量爪合拢', 'warn');
      if (this.calProblem()) return a.toast(this.calProblem(), 'warn');
      t.set(0, 'v', Math.round(this.calRead * 100) / 100);
    } else if (this.tool === 'mic') {
      if (this.micAt !== 'z') return a.toast('读零点时测砧之间不能夹东西：选“零点”', 'warn');
      const p = this.mic.problem(); if (p) return a.toast(p, 'warn');
      t.set(1, 'v', Math.round(this.mic.reading * 1000) / 1000);
    } else a.toast('天平不需要在这里记零点：空盘时按“置零”即可', 'warn');
  }
  recCyl(t) {
    const a = this.app;
    if (this.tool !== 'cal') return a.toast('这张表记游标卡尺的读数：先在读数窗选游标卡尺', 'warn');
    if (this.feat === 'z') return a.toast('现在量爪是合拢的（读零点）。选择要测的尺寸：外径、内径或高', 'warn');
    const p = this.calProblem(); if (p) return a.toast(p, 'warn');
    const i = this.nextRow('cyl', this.feat), r = t.rows[i];
    if (r[this.feat] != null && r[this.feat] !== '' && isFinite(r[this.feat])) return a.toast(`${FEATS[this.feat]} 已经测满 ${N} 次`, 'warn');
    t.set(i, this.feat, Math.round(this.calRead * 100) / 100);
    // 换一个位置：工件尺寸变了，量爪退开一点
    const s = this.calSize();
    if (this.feat === 'd') this.cal.open = s - 0.6; else { this.cal.obj = s; this.cal.open = s + 0.6; }
    a.changed();
  }
  recBall(t) {
    const a = this.app;
    if (this.tool !== 'mic' || this.micAt !== 'b') return a.toast('把钢球放进螺旋测微器的测砧之间（“测量”选“钢球直径”）', 'warn');
    const p = this.mic.problem();
    if (p) { if (this.mic.squeeze > 0.0015) a.toast(p, 'warn'); else return a.toast(p, 'warn'); }
    const i = this.nextRow('ball', 'r'), r = t.rows[i];
    if (r.r != null && r.r !== '' && isFinite(r.r)) return a.toast(`已经测满 ${N} 次`, 'warn');
    t.set(i, 'r', Math.round(this.mic.reading * 1000) / 1000);
    this.mic.locked = false; this.mic.setObject(this.balls[this.nextRow('ball', 'r')]); this.mic.gap = this.mic.obj + 0.4; this.mic.squeeze = 0;
    a.changed();
  }
  recMass(t) {
    const a = this.app;
    if (!this.pan) return a.toast('秤盘是空的：先放上要称的物体', 'warn');
    if (Math.abs(this.balOff) > 0.004) a.toast(this.balOff < 0 ? '天平是在放着东西时置零的，示数偏小：拿下来重新置零再称' : '天平没有置零，示数里含有零漂：应先空盘置零', 'warn');
    t.set(this.pan === 'cyl' ? 0 : 1, 'm', this.balShow);
  }

  // ======================= 自动操作 =======================
  async knob(get, set, to, ms = 400) { await this.app.tween(get, set, to, ms); set(to); this.app.changed(); }
  async calMeasure() {
    const s = this.calSize(), a = this.app;
    if (this.feat === 'd') { await this.knob(() => this.cal.open, (v) => this.calPush(v), s - 0.5, 250); await this.knob(() => this.cal.open, (v) => this.calPush(v), s + 0.2, 250); }
    else if (this.feat === 'z') { await this.knob(() => this.cal.open, (v) => this.calPush(v), -0.2, 300); }
    else { await this.knob(() => this.cal.open, (v) => this.calPush(v), s + 0.5, 250); await this.knob(() => this.cal.open, (v) => this.calPush(v), s - 0.2, 250); }
    a.changed();
  }
  async micMeasure() {
    const stop = this.mic.stop;
    this.mic.locked = false;
    await this.knob(() => this.mic.gap, (v) => this.mic.turnThimble(v), stop + 0.1, 250);
    await this.knob(() => this.mic.gap, (v) => this.mic.turnRatchet(v), stop - 0.01, 250);
  }
  steps() {
    const app = this.app;
    const filled = (id, k) => app.table(id).rows.filter((r) => r[k] != null && r[k] !== '' && isFinite(r[k])).length;
    return [
      {
        title: '读游标卡尺和螺旋测微器的零点',
        html: '<p>游标卡尺：两量爪合拢，看游标 0 线是否对准主尺 0 线，读出零点读数。螺旋测微器：转动测力装置使测杆与测砧刚好接触（听到“咔咔”声），读出零点读数（可正可负）。</p>',
        hint: '零点读数 = 游标 0 线（或微分筒 0 线）偏离的格数 × 分度值，在 0 线右边（上边）为正。',
        check: () => filled('zero', 'v') >= 2,
        diagnose: () => {
          const out = [];
          if (this.tool === 'cal' && this.feat !== 'z') out.push({ msg: '读卡尺零点时量爪之间不能夹东西。', fix: { label: '切到读零点', run: () => this.setFeat('z') } });
          if (this.tool === 'mic' && this.micAt !== 'z') out.push({ msg: '读千分尺零点时测砧之间不能夹东西。', fix: { label: '取出钢球', run: () => this.setMic('z') } });
          if (this.tool === 'mic' && this.mic.locked) out.push({ msg: '锁紧装置锁着，测杆转不动。', fix: { label: '松开锁紧', run: () => { this.mic.locked = false; app.renderInspector(); } } });
          return out;
        },
        auto: async () => {
          app.showTable(0); app.select(app.comp('cal')); this.setFeat('z'); app.renderInspector();
          await this.calMeasure(); await app.record('zero');
          app.select(app.comp('mic')); this.setMic('z'); app.renderInspector();
          await this.micMeasure(); await app.record('zero');
          this.mic.turnRatchet(2);
        },
      },
      {
        title: '用游标卡尺测空心圆柱的外径、内径和高',
        html: '<p>外径 $D$ 用外量爪、内径 $d$ 用内量爪、高 $H$ 用外量爪，在不同位置和方向各测 6 次。量爪要贴紧但不能夹得太紧，读数时视线垂直尺面。</p>',
        hint: '游标卡尺读数 = 主尺上游标 0 线左边的整毫米数 + 对齐的游标格数 × 0.02 mm，不估读。',
        status: () => `外径 ${filled('cyl', 'D')}/6，内径 ${filled('cyl', 'd')}/6，高 ${filled('cyl', 'H')}/6`,
        check: () => ['D', 'd', 'H'].every((k) => filled('cyl', k) >= N),
        diagnose: () => {
          const out = [];
          if (this.tool !== 'cal') out.push({ msg: '这一步用游标卡尺。', fix: { label: '拿起游标卡尺', run: () => { this.tool = 'cal'; app.select(app.comp('cal')); app.changed(); } } });
          else if (this.feat === 'z') out.push({ msg: '先选要测的尺寸（外径、内径或高）。', fix: { label: '测外径', run: () => { this.setFeat('D'); app.renderInspector(); } } });
          else if (this.calProblem()) out.push({ msg: this.calProblem() + '。' });
          return out;
        },
        auto: async () => {
          app.showTable(1); app.select(app.comp('cal'));
          for (const k of ['D', 'd', 'H']) {
            this.setFeat(k); app.renderInspector();
            while (filled('cyl', k) < N) { await this.calMeasure(); await app.record('cyl'); }
          }
        },
      },
      {
        title: '用螺旋测微器测钢球直径',
        html: '<p>把钢球放在测砧与测杆之间，先转微分筒使测杆接近钢球，再转测力装置到“咔咔”声响起，读数（估读到 0.001 mm）。转动钢球换方向，共测 6 次。</p>',
        hint: '直接用微分筒拧紧会把钢球与测砧压出弹性变形，读数偏小几微米。',
        status: () => `已测 ${filled('ball', 'r')}/6 次`,
        check: () => filled('ball', 'r') >= N,
        diagnose: () => {
          const out = [];
          if (this.tool !== 'mic' || this.micAt !== 'b') out.push({ msg: '把钢球放进螺旋测微器。', fix: { label: '放入钢球', run: () => { this.setMic('b'); app.select(app.comp('mic')); } } });
          else if (this.mic.locked) out.push({ msg: '锁紧装置锁着，测杆转不动。', fix: { label: '松开锁紧', run: () => { this.mic.locked = false; app.renderInspector(); } } });
          else if (this.mic.squeeze > 0.0015) out.push({ msg: '微分筒拧过头了，钢球被压得变形，读数偏小。退开后用测力装置重新夹。' });
          return out;
        },
        auto: async () => {
          app.showTable(2); app.select(app.comp('mic')); this.setMic('b'); app.renderInspector();
          while (filled('ball', 'r') < N) { await this.micMeasure(); await app.record('ball'); }
        },
      },
      {
        title: '用电子天平称质量',
        html: '<p>秤盘空着时按“置零”，再分别放上空心圆柱和钢球，示数稳定后记录质量。</p>',
        check: () => filled('mass', 'm') >= 2,
        diagnose: () => {
          const out = [];
          if (Math.abs(this.balOff) > 0.004) out.push({ msg: this.balOff < 0 ? '天平是在秤盘上有东西时置零的，称出来会偏小。' : '天平空盘时示数不为零，要先置零。', fix: { label: '拿下物体并置零', run: () => { this.pan = null; this.tare(); app.renderInspector(); } } });
          return out;
        },
        auto: async () => {
          app.showTable(3); app.select(app.comp('bal')); this.tool = 'bal';
          this.pan = null; app.renderInspector(); await app.wait(300); this.tare(); await app.wait(300);
          for (const p of ['cyl', 'ball']) { this.pan = p; app.renderInspector(); app.changed(); await app.wait(500); await app.record('mass'); }
          this.pan = null; app.renderInspector();
        },
      },
      {
        title: '数据处理',
        html: '<p>修正零点后求各量的平均值、A 类与 B 类不确定度，合成后按传递公式求密度及其不确定度，写出测量结果。</p>',
        check: () => app.analysisDone,
        auto: async () => { app.showAnalysis(); await app.wait(600); },
      },
    ];
  }

  // ======================= 数据处理 =======================
  analyze() {
    const a = this.app, zr = a.table('zero').rows;
    const z1 = +zr[0].v, z2 = +zr[1].v;
    if (!isFinite(z1) || !isFinite(z2)) return { html: '<p>请先记录游标卡尺和螺旋测微器的零点读数。</p>', ok: false };
    const col = (id, k, z) => a.table(id).rows.map((r) => r[k]).filter((x) => x != null && x !== '' && isFinite(x)).map((x) => +x - z);
    const D = col('cyl', 'D', z1), d = col('cyl', 'd', z1), H = col('cyl', 'H', z1), b = col('ball', 'r', z2);
    const mr = a.table('mass').rows, m1 = +mr[0].m, m2 = +mr[1].m;
    let html = `<p>零点读数：游标卡尺 ${z1.toFixed(2)} mm，螺旋测微器 ${z2.toFixed(3)} mm。下表中的值已减去零点。</p>`, ok = false;
    const answers = [];
    const stat = (xs, ins, dig) => { const m = mean(xs), A = uA(xs), B = ins / Math.sqrt(3); return { m, A, B, u: Math.hypot(A, B), S: stdev(xs), dig }; };
    const row = (name, s, unit) => `<tr><td>${name}</td><td>${s.m.toFixed(s.dig + 1)}</td><td>${s.S.toFixed(s.dig + 1)}</td><td>${s.A.toFixed(s.dig + 1)}</td><td>${s.B.toFixed(s.dig + 1)}</td><td>${s.u.toFixed(s.dig + 1)}</td><td>${unit}</td></tr>`;
    const head = '<table><tr><th>量</th><th>平均值</th><th>S(x)</th><th>u_A = S/√n</th><th>u_B = Δ/√3</th><th>u</th><th></th></tr>';
    if (D.length >= 3 && d.length >= 3 && H.length >= 3 && isFinite(m1)) {
      const sD = stat(D, D_CAL, 2), sd = stat(d, D_CAL, 2), sH = stat(H, D_CAL, 2), um1 = D_BAL / Math.sqrt(3);
      const A2 = sD.m ** 2 - sd.m ** 2, rho = (4 * m1 * 1000) / (Math.PI * A2 * sH.m); // g/cm³
      const er = Math.sqrt((um1 / m1) ** 2 + ((2 * sD.m * sD.u) / A2) ** 2 + ((2 * sd.m * sd.u) / A2) ** 2 + (sH.u / sH.m) ** 2), ur = rho * er;
      html += `<h3>1. 空心铜圆柱</h3>${head}${row('D', sD, 'mm')}${row('d', sd, 'mm')}${row('H', sH, 'mm')}<tr><td>m₁</td><td>${m1.toFixed(2)}</td><td>—</td><td>—</td><td>${um1.toFixed(3)}</td><td>${um1.toFixed(3)}</td><td>g</td></tr></table>
        <p>游标卡尺 Δ = 0.02 mm，电子天平 Δ = 0.02 g。</p>
        <p>$\\rho=\\dfrac{4m}{\\pi(D^2-d^2)H}=${rho.toFixed(4)}\\ \\mathrm{g/cm^3}$</p>
        <p>$\\dfrac{u_\\rho}{\\rho}=\\sqrt{\\left(\\dfrac{u_m}{m}\\right)^2+\\left(\\dfrac{2Du_D}{D^2-d^2}\\right)^2+\\left(\\dfrac{2du_d}{D^2-d^2}\\right)^2+\\left(\\dfrac{u_H}{H}\\right)^2}=${(er * 100).toFixed(3)}\\%$</p>
        <p>各项贡献：$m$ ${((um1 / m1) * 100).toFixed(3)}%，$D$ ${(((2 * sD.m * sD.u) / A2) * 100).toFixed(3)}%，$d$ ${(((2 * sd.m * sd.u) / A2) * 100).toFixed(3)}%，$H$ ${((sH.u / sH.m) * 100).toFixed(3)}%。</p>
        <div class="result-box">$\\rho_1=${fmtU(rho, ur).replace('±', '\\pm')}\\ \\mathrm{g/cm^3}$</div>
        <div class="result-box warn">这块黄铜的实际密度为 ${this.rhoC.toFixed(3)} g/cm³，相对误差 ${pct(relErr(rho, this.rhoC))}。</div>`;
      answers.push({ label: '$\\rho_1$', unit: 'g/cm³', value: rho, digits: 3, tolRel: 0.003 }, { label: '$u_{\\rho_1}$', unit: 'g/cm³', value: ur, digits: 3, tolRel: 0.2 });
      ok = true;
    } else html += '<h3>1. 空心铜圆柱</h3><p>外径、内径、高至少各测 3 次，并称出质量。</p>';
    if (b.length >= 3 && isFinite(m2)) {
      const sb = stat(b, D_MIC, 3), um2 = D_BAL / Math.sqrt(3);
      const rho = (6 * m2 * 1000) / (Math.PI * sb.m ** 3), er = Math.hypot(um2 / m2, (3 * sb.u) / sb.m), ur = rho * er;
      html += `<h3>2. 钢球</h3>${head}${row('d', sb, 'mm')}<tr><td>m₂</td><td>${m2.toFixed(2)}</td><td>—</td><td>—</td><td>${um2.toFixed(3)}</td><td>${um2.toFixed(3)}</td><td>g</td></tr></table>
        <p>一级千分尺 Δ = 0.004 mm。$\\rho=\\dfrac{6m}{\\pi d^3}=${rho.toFixed(4)}\\ \\mathrm{g/cm^3}$，$\\dfrac{u_\\rho}{\\rho}=\\sqrt{\\left(\\dfrac{u_m}{m}\\right)^2+\\left(\\dfrac{3u_d}{d}\\right)^2}=${(er * 100).toFixed(3)}\\%$（质量项 ${((um2 / m2) * 100).toFixed(3)}%，直径项 ${(((3 * sb.u) / sb.m) * 100).toFixed(3)}%）。</p>
        <div class="result-box">$\\rho_2=${fmtU(rho, ur).replace('±', '\\pm')}\\ \\mathrm{g/cm^3}$</div>
        <div class="result-box warn">钢球的实际密度为 ${this.rhoB.toFixed(3)} g/cm³，相对误差 ${pct(relErr(rho, this.rhoB))}。钢球只有几克，电子天平 0.02 g 的允差成了主要误差来源；可以把几个同批钢球一起称，或换用分度值 1 mg 的天平。</div>`;
      answers.push({ label: '$\\rho_2$', unit: 'g/cm³', value: rho, digits: 3, tolRel: 0.003 });
      ok = true;
    } else html += '<h3>2. 钢球</h3><p>钢球直径至少测 3 次，并称出质量。</p>';
    html += '<p>说明：A 类不确定度取平均值的实验标准差 $S(\\bar x)=S(x)/\\sqrt n$；B 类不确定度按仪器最大允差 Δ 服从均匀分布取 $\\Delta/\\sqrt3$。忘记修正零点会带来系统误差，不能靠多次测量消除。</p>';
    return { html, ok, answers };
  }

  principle() {
    const vern = `<svg viewBox="0 0 520 120" style="max-width:520px;width:100%" font-family="IBM Plex Mono, monospace" font-size="11">
      <rect x="10" y="20" width="500" height="40" fill="#e3e6ea" stroke="#4b5963"/>
      ${Array.from({ length: 50 }, (_, k) => `<line x1="${20 + k * 10}" y1="60" x2="${20 + k * 10}" y2="${k % 10 === 0 ? 38 : k % 5 === 0 ? 44 : 50}" stroke="#1d2832"/>`).join('')}
      ${[0, 1, 2, 3, 4].map((k) => `<text x="${20 + k * 100}" y="34" text-anchor="middle">${k}</text>`).join('')}
      <rect x="140" y="60" width="370" height="36" fill="#c9ced3" stroke="#4b5963"/>
      ${Array.from({ length: 41 }, (_, j) => `<line x1="${163 + j * 9.8}" y1="60" x2="${163 + j * 9.8}" y2="${j % 5 === 0 ? 76 : 70}" stroke="${j === 15 ? '#c41e3a' : '#1d2832'}" stroke-width="${j === 15 ? 2 : 1}"/>`).join('')}
      <text x="163" y="90" text-anchor="middle">0</text><text x="310" y="108" fill="#c41e3a" text-anchor="middle">第 15 格对齐</text>
      <text x="14" y="14">主尺（mm）</text><text x="400" y="114">读数 = 14 + 15×0.02 = 14.30 mm</text></svg>`;
    return `<h3>1. 游标卡尺</h3>${vern}<p>主尺分度 1 mm，游标上 $n$ 格的总长等于主尺 $n-1$ 格，每格比主尺短 $\\dfrac1n$ mm。游标 0 线越过主尺某刻线 $\\Delta x$ 时，必有游标第 $k=\\Delta x\\cdot n$ 条刻线与主尺刻线对齐，于是</p>$$L=\\text{整毫米数}+k\\cdot\\frac1n\\ \\mathrm{mm}$$<p>50 分度游标的分度值为 0.02 mm。游标卡尺靠刻线对齐读数，不估读。</p>
<h3>2. 螺旋测微器</h3><p>测杆的螺距为 0.5 mm，微分筒转一周测杆进退 0.5 mm；微分筒圆周分 50 格，每格对应 0.01 mm，还要再估读一位到 0.001 mm。读数 = 固定套管上露出的整毫米和半毫米 + 微分筒格数 × 0.01 mm。这是“机械放大法”：把 0.01 mm 的位移放大成微分筒外缘约 1 mm 的弧长。</p>
<h3>3. 零点修正</h3><p>量具合拢时的读数叫零点读数 $x_0$（可正可负），测量值 $x=x_{\\text{读}}-x_0$。零点误差是系统误差，必须修正。</p>
<h3>4. 不确定度</h3><p>对同一量测量 $n$ 次：A 类不确定度 $u_A=S(\\bar x)=\\sqrt{\\dfrac{\\sum(x_i-\\bar x)^2}{n(n-1)}}$；B 类不确定度由仪器最大允差 Δ 估计，$u_B=\\Delta/\\sqrt3$；合成 $u=\\sqrt{u_A^2+u_B^2}$。</p><p>间接测量量 $\\rho=f(m,D,d,H)$ 的不确定度按方和根传递。乘除形式的函数先取对数再求偏导最方便：</p>$$\\frac{u_\\rho}{\\rho}=\\sqrt{\\sum\\left(\\frac{\\partial\\ln\\rho}{\\partial x_i}u_{x_i}\\right)^2}$$<p>结果写成 $\\rho=(\\bar\\rho\\pm u_\\rho)$ 单位，不确定度保留一到两位有效数字，测量值的末位与不确定度对齐。</p>
<h3>5. 本仿真的模型</h3><p>空心圆柱的外径、内径带有约 ±0.01 mm 的锥度和随机起伏，钢球有微米级的不圆度，所以多次测量的离散是真实存在的，不是人为加的“噪声”。螺旋测微器若直接拧微分筒，会把钢球压出几微米的变形；电子天平开机后有零漂，需先置零。</p>`;
  }
}
