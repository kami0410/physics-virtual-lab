// 交流电路仪器：函数信号发生器、待测信号源、双踪示波器，以及把接线转换成 SPICE 网表的 acNet()
// 电路计算交给 spice.js（spice-ts），示波器扫描/触发逻辑在 scopeEngine.js，这里负责三维模型、面板控件和荧光屏绘制。
import * as THREE from 'three';
import { Component } from './Component.js';
import { MAT, mesh } from './Models.js';
import { panelMesh } from './circuit.js';
import { rand, clamp } from './Stats.js';
import { LinearNet, periodicSteady } from './spice.js';
import { ScopeEngine, defaultSettings, VDIV, TDIV, fmtV, fmtT } from './scopeEngine.js';

/** 由实验桌上的接线和已摆放的仪器建立线性电路（导线并为同一节点；仪器的“⊥”经电源插头接大地） */
export function acNet(cir) {
  const elems = [], earth = [];
  for (const w of cir.wires) elems.push({ type: 'W', a: w.a, b: w.b });
  for (const d of cir.devices.values()) {
    if (!d.comp.placed) continue;
    const t = (n) => `${d.key}:${n}`;
    const list = d.ac ? d.ac(t) : d.elements(t).filter((e) => e.type === 'R' && e.a !== e.b);
    elems.push(...list);
    for (const n of d.earth || []) earth.push(t(n));
  }
  return new LinearNet(elems, earth);
}

/** 离散档位旋钮（拖动时累计小数，显示与取值取整） */
export function stepKnob(label, get, set, n, fmt, sub) {
  let acc = get();
  return {
    type: 'knob', label, sub, step: 1, bigStep: 3, perRev: 12, min: 0, max: n - 1,
    get: () => (Math.round(acc) === get() ? acc : (acc = get())),
    set: (v) => { acc = clamp(v, 0, n - 1); set(Math.round(acc)); },
    fmt: (v) => fmt(Math.round(v)),
    angle: (v) => (Math.round(v) / Math.max(1, n - 1)) * 300 - 150,
  };
}

const fmtF = (f) => (f >= 1e6 ? `${(f / 1e6).toFixed(5)} MHz` : f >= 1e3 ? `${(f / 1e3).toFixed(4)} kHz` : `${f.toFixed(f < 100 ? 3 : 2)} Hz`);
const SHAPE_NAME = { sine: '正弦', square: '方波', triangle: '三角' };

// ============================ 函数信号发生器 ============================
const GEN_RANGES = [10, 100, 1e3, 1e4, 1e5, 1e6];
export function funcGen({ key = 'gen', name = '函数信号发生器', short = '信号发生器', defaultSlot, f = 1000, vpp = 4, shape = 'sine' }) {
  const W = 24, D = 15, Hh = 9;
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(W, Hh, D), MAT.paint(0xd8d4ca), 0, Hh / 2, 0));
  g.add(mesh(new THREE.BoxGeometry(W + 0.3, 0.5, D + 0.3), MAT.paint(0x2b2f33), 0, Hh + 0.2, 0));
  const cv = document.createElement('canvas'); cv.width = 576; cv.height = 216;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(W - 1, Hh - 1), new THREE.MeshBasicMaterial({ map: tex }));
  panel.position.set(0, Hh / 2, D / 2 + 0.02); panel.userData.noHL = true; g.add(panel);
  const knobs = [];
  for (const x of [-6, -1.5, 3]) { const k = mesh(new THREE.CylinderGeometry(0.9, 1, 1.1, 20), MAT.black(), x, 2.0, D / 2 + 0.55); k.rotation.x = Math.PI / 2; g.add(k); knobs.push(k); }
  const fErr = rand(-2e-5, 2e-5); // 频率准确度 ±20 ppm（固定）
  const aErr = 1 + rand(-0.01, 0.01); // 幅度准确度 ±1%
  const dev = {
    key, short, on: false, shape, f, vpp, off: 0, offOn: false, range: GEN_RANGES.findIndex((r) => f <= r * 2) ,
    terms: { out: { pos: new THREE.Vector3(7, 0.2, D / 2 + 0.2), color: 0xb91c1c, label: '输出' }, gnd: { pos: new THREE.Vector3(9.6, 0.2, D / 2 + 0.2), color: 0x1b1b1b, label: '⊥' } },
    earth: ['gnd'],
    /** 实际输出波形（含仪器误差）。幅度为开路值 */
    wave() {
      const amp = Math.min(this.vpp / 2, Math.max(0, 10 - Math.abs(this.offOn ? this.off : 0)));
      return { shape: this.shape, f: this.f * (1 + fErr), amp: amp * aErr, off: this.offOn ? this.off : 0 };
    },
    ac(t) { return this.on ? [{ type: 'V', a: t('out'), b: t('gnd'), w: this.wave(), r: 50 }] : []; },
    elements() { return []; },
    after() { draw(); },
  };
  if (dev.range < 0) dev.range = GEN_RANGES.length - 1;
  const draw = () => {
    const c = cv.getContext('2d');
    c.fillStyle = '#d8d4ca'; c.fillRect(0, 0, 576, 216);
    c.fillStyle = '#1f2937'; c.font = 'bold 19px "Microsoft YaHei"'; c.fillText(name + '   0.1 Hz – 2 MHz', 14, 26);
    c.fillStyle = '#0b1410'; c.fillRect(14, 38, 548, 74);
    c.fillStyle = dev.on ? '#7dff9e' : '#21402a'; c.font = 'bold 44px Consolas, monospace'; c.textAlign = 'right';
    c.fillText(dev.on ? fmtF(dev.f).split(' ')[0] : '-----', 330, 94);
    c.font = 'bold 22px Consolas'; c.textAlign = 'left'; c.fillText(dev.on ? fmtF(dev.f).split(' ')[1] : '', 336, 94);
    c.textAlign = 'right'; c.font = 'bold 32px Consolas'; c.fillText(dev.on ? dev.vpp.toFixed(2) : '--', 500, 94);
    c.font = 'bold 18px Consolas'; c.textAlign = 'left'; c.fillText('Vpp', 506, 94);
    c.textAlign = 'left'; c.fillStyle = '#1f2937'; c.font = '15px "Microsoft YaHei"';
    ['sine', 'square', 'triangle'].forEach((s, i) => { c.fillStyle = dev.shape === s ? '#b91c1c' : '#4b5563'; c.fillText((dev.shape === s ? '● ' : '○ ') + SHAPE_NAME[s], 16 + i * 74, 140); });
    c.fillStyle = '#4b5563'; c.fillText('频率', 150, 202); c.fillText('幅度', 238, 202); c.fillText('偏置', 330, 202);
    c.fillText(dev.offOn ? `偏置 ${dev.off.toFixed(2)} V` : '偏置 关', 250, 140);
    c.fillText('输出 50 Ω', 420, 140);
    c.fillStyle = dev.on ? '#22c55e' : '#3f3f3f'; c.beginPath(); c.arc(516, 135, 7, 0, 7); c.fill();
    tex.needsUpdate = true;
  };
  draw();
  const knobRot = () => { knobs[0].rotation.y = -Math.log10(dev.f) * 1.3; knobs[1].rotation.y = -dev.vpp / 20 * 5; knobs[2].rotation.y = -dev.off / 10 * 2.5; };
  dev.setF = (v) => { dev.f = clamp(v, 0.1, 2e6); knobRot(); };
  /** 频率旋钮：每格改变 档位×unit（转一圈 50 格），读数窗显示当前频率 */
  const relKnob = (label, unit) => {
    let u = 0;
    return { type: 'knob', label, step: 1, bigStep: 10, perRev: 50, get: () => u, set: (v) => { const d = v - u; u = v; dev.setF(+(dev.f + d * GEN_RANGES[dev.range] * unit).toPrecision(9)); }, fmt: () => fmtF(dev.f) };
  };
  dev.comp = new Component({
    key, name, icon: GEN_ICON, zone: 'slot', defaultSlot, object: g, labelY: 14,
    desc: '直接数字合成 (DDS) 信号发生器：正弦、方波、三角波，0.1 Hz – 2 MHz，频率准确度 ±20 ppm；幅度 0–20 Vpp（显示为开路值，±1%），可加直流偏置；输出阻抗 50 Ω。“⊥”端经电源插头接地。',
    controls: () => [
      { type: 'toggle', label: '输出开关', get: () => dev.on, set: (v) => (dev.on = v) },
      { type: 'segment', label: '波形', options: [{ value: 'sine', label: '正弦' }, { value: 'square', label: '方波' }, { value: 'triangle', label: '三角' }], get: () => dev.shape, set: (v) => (dev.shape = v) },
      { type: 'select', label: '频率档（决定旋钮步长）', options: ['≤ 20 Hz', '≤ 200 Hz', '≤ 2 kHz', '≤ 20 kHz', '≤ 200 kHz', '≤ 2 MHz'].map((label, i) => ({ value: String(i), label })), get: () => String(dev.range), set: (v) => (dev.range = +v) },
      relKnob('频率 粗调', 1e-2),
      relKnob('频率 细调', 1e-5),
      { type: 'knob', label: '幅度（峰峰值，开路）', get: () => dev.vpp, set: (v) => { dev.vpp = clamp(v, 0, 20); knobRot(); }, min: 0, max: 20, step: 0.01, bigStep: 0.2, perRev: 4, digits: 2, unit: 'Vpp' },
      { type: 'toggle', label: '直流偏置', get: () => dev.offOn, set: (v) => (dev.offOn = v) },
      { type: 'knob', label: '偏置电压', get: () => dev.off, set: (v) => { dev.off = clamp(v, -10, 10); knobRot(); }, min: -10, max: 10, step: 0.01, bigStep: 0.5, perRev: 4, digits: 2, unit: 'V' },
    ],
  });
  knobRot();
  return dev;
}
const GEN_ICON = '<svg viewBox="0 0 64 40"><rect x="5" y="6" width="54" height="28" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="9" y="10" width="28" height="9" fill="none" stroke="currentColor"/><path d="M11 15q3-5 6 0t6 0t6 0t6 0" fill="none" stroke="currentColor"/><circle cx="46" cy="27" r="2" fill="#c41e3a"/><circle cx="53" cy="27" r="2" fill="currentColor"/></svg>';

/** 待测信号源：频率未知的正弦信号（面板上不显示频率） */
export function mysterySource({ key = 'unk', name = '待测信号源', defaultSlot, f, vpp = 3 }) {
  const W = 12, D = 10, Hh = 6;
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(W, Hh, D), MAT.paint(0x3b4a5a), 0, Hh / 2, 0));
  const lab = panelMesh(W - 1, Hh - 1.4, (c, w, h) => {
    c.fillStyle = '#3b4a5a'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#e8e4d8'; c.font = `bold ${h * 0.2}px "Microsoft YaHei"`; c.textAlign = 'center'; c.fillText(name, w / 2, h * 0.32);
    c.font = `${h * 0.13}px "Microsoft YaHei"`; c.fillText('正弦 · 频率未知', w / 2, h * 0.58);
  });
  lab.position.set(0, Hh / 2 + 0.5, D / 2 + 0.02); g.add(lab);
  const dev = {
    key, short: name, on: true, f, vpp,
    terms: { out: { pos: new THREE.Vector3(2, 0.2, D / 2 + 0.2), color: 0xb91c1c, label: '输出' }, gnd: { pos: new THREE.Vector3(4.4, 0.2, D / 2 + 0.2), color: 0x1b1b1b, label: '⊥' } },
    earth: ['gnd'],
    ac(t) { return this.on ? [{ type: 'V', a: t('out'), b: t('gnd'), w: { shape: 'sine', f: this.f, amp: this.vpp / 2 }, r: 600 }] : []; },
    elements() { return []; },
  };
  dev.comp = new Component({
    key, name, icon: GEN_ICON, zone: 'slot', defaultSlot, object: g, labelY: 10,
    desc: '输出一个频率未知的正弦信号（几百赫兹），输出阻抗 600 Ω。用李萨如图形把它与信号发生器的已知频率比较，测出它的频率。',
    controls: () => [{ type: 'toggle', label: '电源', get: () => dev.on, set: (v) => (dev.on = v) }],
  });
  return dev;
}

// ============================ 双踪示波器 ============================
const SCR = { x: 20, y: 14, div: 32 }; // 观察窗中荧光屏的位置与每格像素
const C_AC = 0.047e-6, R_IN = 1e6, C_IN = 20e-12;

export function oscilloscope({ app, key = 'osc', name = '双踪示波器', defaultSlot, view }) {
  const W = 34, D = 26, Hh = 15;
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(W, Hh, D), MAT.paint(0xc7c9c4), 0, Hh / 2, 0));
  g.add(mesh(new THREE.BoxGeometry(W + 0.4, 1.2, D + 0.4), MAT.paint(0x2e3236), 0, Hh + 0.3, 0));
  for (const sx of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(1.2, 1.4, 3), MAT.black(), sx * (W / 2 - 3), 0.7 - 0.7, D / 2 - 3));
  // 前面板
  const panel = panelMesh(W - 0.6, Hh - 0.6, (c, w, h) => {
    c.fillStyle = '#c7c9c4'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#1b1d20'; c.fillRect(w * 0.03, h * 0.07, w * 0.44, h * 0.66);
    c.fillStyle = '#2a2d31'; c.font = `bold ${h * 0.045}px "Microsoft YaHei"`; c.fillText('双踪示波器  20 MHz', w * 0.03, h * 0.05);
    c.font = `${h * 0.032}px Arial`; c.fillStyle = '#3a3d42';
    const L = [['INTEN', 0.06, 0.82], ['FOCUS', 0.16, 0.82], ['CH1 VOLTS/DIV', 0.52, 0.42], ['CH2 VOLTS/DIV', 0.68, 0.42], ['TIME/DIV', 0.86, 0.22], ['MODE', 0.6, 0.12], ['LEVEL', 0.86, 0.6], ['CH1(X)', 0.5, 0.95], ['CH2(Y)', 0.66, 0.95], ['EXT', 0.86, 0.95]];
    for (const [s, x, y] of L) c.fillText(s, w * x, h * y);
  }, 20);
  panel.position.set(0, Hh / 2, D / 2 + 0.02); g.add(panel);
  // 荧光屏（贴图由显示缓冲更新）
  const scv = document.createElement('canvas'); scv.width = 320; scv.height = 256;
  const stex = new THREE.CanvasTexture(scv); stex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry((W - 0.6) * 0.42, (W - 0.6) * 0.42 * 0.8), new THREE.MeshBasicMaterial({ map: stex }));
  screen.position.set(-W / 2 + 0.3 + (W - 0.6) * 0.25, Hh / 2 + (Hh - 0.6) * 0.1, D / 2 + 0.06); screen.userData.noHL = true; g.add(screen);
  const knob = (x, y, r = 0.9) => { const k = mesh(new THREE.CylinderGeometry(r, r * 1.08, 1, 20), MAT.black(), x, y, D / 2 + 0.5); k.rotation.x = Math.PI / 2; g.add(k); return k; };
  const kb = { inten: knob(-14, 1.8, 0.6), focus: knob(-10.6, 1.8, 0.6), v1: knob(2.5, 7.5, 1.3), v2: knob(8, 7.5, 1.3), t: knob(13.5, 10.5, 1.5), lvl: knob(13.5, 4.5, 0.8), p1: knob(2.5, 3.4, 0.6), p2: knob(8, 3.4, 0.6) };

  const s = defaultSettings();
  s.power = false; s.inten = 0.22; s.focus = Math.random() < 0.5 ? 0.2 : 0.82; s.ch[0].pos = rand(1.2, 2.2) * (Math.random() < 0.5 ? -1 : 1); s.ch[1].pos = rand(-1.5, 1.5);
  const eng = new ScopeEngine(s);
  eng.gain = [1 + rand(-0.02, 0.02), 1 + rand(-0.02, 0.02)]; eng.tcal = 1 + rand(-0.02, 0.02); // 垂直、水平误差在 ±3% 指标内
  const dev = {
    key, short: '示波器', s, eng,
    terms: {
      ch1: { pos: new THREE.Vector3(1.5, 0.3, D / 2 + 0.25), color: 0xd4a017, label: 'CH1(X)' },
      ch2: { pos: new THREE.Vector3(6.8, 0.3, D / 2 + 0.25), color: 0x1f4fbf, label: 'CH2(Y)' },
      gnd: { pos: new THREE.Vector3(11, 0.3, D / 2 + 0.25), color: 0x1b1b1b, label: '⊥' },
    },
    earth: ['gnd'],
    ac(t) {
      const out = [];
      s.ch.forEach((ch, i) => {
        const inp = t('ch' + (i + 1)), node = t('_i' + (i + 1));
        if (ch.cpl === 'DC') out.push({ type: 'W', a: inp, b: node });
        else if (ch.cpl === 'AC') out.push({ type: 'C', a: inp, b: node, C: C_AC });
        else out.push({ type: 'W', a: node, b: t('gnd') }); // GND：输入端断开，放大器输入接地
        out.push({ type: 'R', a: node, b: t('gnd'), R: R_IN }, { type: 'C', a: node, b: t('gnd'), C: C_IN });
      });
      return out;
    },
    elements() { return []; },
    probes(t) { return { ch1: [t('_i1'), t('gnd')], ch2: [t('_i2'), t('gnd')] }; },
  };

  // ---------- 信号计算（异步，接线或设置变化时） ----------
  // 同一时刻只算一个电路；计算期间设置又变了，只保留最新的一份，算完再接着算（连续拧旋钮时计算不会堆积）
  let lastKey = '', pending = null, running = false;
  dev.busy = false;
  const t = (n) => `${key}:${n}`;
  const run = () => {
    const net = pending; pending = null; running = true; dev.busy = true;
    periodicSteady(net, dev.probes(t)).then((res) => {
      if (!pending) { dev.sig = res; eng.setSignal(res); }
    }).catch((e) => {
      if (pending) return;
      dev.sig = null; eng.setSignal(null);
      console.warn('[osc] 电路计算失败', e);
      app.toast('电路无法计算：' + (e && e.message ? e.message.slice(0, 80) : e), 'warn');
    }).finally(() => {
      running = false;
      if (pending) run(); else { dev.busy = false; app.changed(); }
    });
  };
  dev.refresh = (cir) => {
    const net = acNet(cir);
    const k = net.key + '|' + net.node(t('_i1')) + net.node(t('_i2')) + net.node(t('gnd'));
    if (k === lastKey) return;
    lastKey = k; pending = net;
    if (!running) run();
  };

  // ---------- 荧光屏 ----------
  let phos = null, pc = null, ps = 0, tSig = Math.random() * 10, last3d = 0;
  const ensure = () => {
    const sc = clamp(Math.round(view.scale * 2) / 2, 1, 2);
    if (phos && ps === sc) return;
    ps = sc; phos = document.createElement('canvas'); phos.width = Math.round(320 * sc); phos.height = Math.round(256 * sc);
    pc = phos.getContext('2d'); pc.fillStyle = '#000'; pc.fillRect(0, 0, phos.width, phos.height);
  };
  const BUCKETS = 8;
  // 每次扫描单独描线并用 'lighter' 叠加：同一帧里重合的多次扫描亮度累加（触发稳定时波形更亮），不重合时各自较暗。
  // 一次扫描内按亮度分桶，相邻同亮度的线段连成一条折线，减少描线次数。
  const paint = (lines) => {
    const sc = ps, dv = 32 * sc;
    const blur = Math.abs(s.focus - 0.5) * 2; // 0 最清晰
    const lw = (1.0 + 4.5 * blur * blur) * sc, I = s.inten;
    pc.globalCompositeOperation = 'lighter'; pc.lineCap = 'round'; pc.lineJoin = 'round';
    for (const { pts, ref, w } of lines) {
      const paths = Array.from({ length: BUCKETS }, () => new Path2D());
      const used = new Array(BUCKETS).fill(false);
      let lastK = -1;
      for (let i = 2; i < pts.length; i += 2) {
        const x0 = pts[i - 2], y0 = pts[i - 1], x1 = pts[i], y1 = pts[i + 1];
        const len = Math.hypot(x1 - x0, y1 - y0);
        const b = w * Math.min(1, ref / Math.max(len, 1e-6));
        if (b < 0.004) { lastK = -1; continue; }
        const k = Math.min(BUCKETS - 1, Math.floor(b * BUCKETS));
        const p = paths[k];
        if (k !== lastK) p.moveTo((x0 + 5) * dv, (4 - y0) * dv);
        p.lineTo((x1 + 5) * dv, (4 - y1) * dv);
        used[k] = true; lastK = k;
      }
      for (let k = 0; k < BUCKETS; k++) {
        if (!used[k]) continue;
        const a = ((k + 0.5) / BUCKETS) * I;
        pc.lineWidth = lw * 3.2; pc.strokeStyle = `rgba(60,255,120,${(a * 0.16) / (1 + 2 * blur)})`; pc.stroke(paths[k]);
        pc.lineWidth = lw; pc.strokeStyle = `rgba(150,255,175,${Math.min(1, a * 0.95 / (1 + 3 * blur * blur))})`; pc.stroke(paths[k]);
      }
    }
    pc.globalCompositeOperation = 'source-over';
  };
  /** 每帧调用：推进时间、画轨迹、刷新观察窗与三维屏幕 */
  dev.frame = (dt) => {
    if (!view) return;
    ensure();
    const t0 = tSig; tSig += Math.min(dt, 0.1);
    pc.fillStyle = `rgba(0,0,0,${1 - Math.exp(-dt / 0.045)})`; pc.fillRect(0, 0, phos.width, phos.height);
    if (s.power && dev.comp.placed) {
      const lines = [];
      eng.frame(t0, tSig, (l) => lines.push(l));
      paint(lines);
    }
  };
  dev.drawView = () => {
    const v = view, c = v.ctx;
    c.fillStyle = '#2b2e31'; c.fillRect(0, 0, v.W, v.H);
    const { x, y, div } = SCR, w = 10 * div, h = 8 * div;
    c.fillStyle = '#050c08'; c.fillRect(x, y, w, h);
    if (phos) c.drawImage(phos, x, y, w, h);
    drawGraticule(c, x, y, div, s.power ? 0.32 : 0.18);
    if (!s.power) { c.fillStyle = 'rgba(255,255,255,.35)'; c.font = '13px "Microsoft YaHei"'; c.textAlign = 'center'; c.fillText('电源未打开', x + w / 2, y + h / 2); c.textAlign = 'left'; }
    // 三维屏幕贴图（约 8 帧/秒）
    const now = performance.now();
    if (now - last3d > 120) {
      last3d = now;
      const sc2 = scv.getContext('2d');
      sc2.fillStyle = '#050c08'; sc2.fillRect(0, 0, 320, 256);
      if (phos) sc2.drawImage(phos, 0, 0, 320, 256);
      drawGraticule(sc2, 0, 0, 32, 0.3);
      stex.needsUpdate = true;
    }
    v.foot(dev.status());
    // 旋钮转角
    kb.inten.rotation.y = -s.inten * 5; kb.focus.rotation.y = -s.focus * 5;
    kb.v1.rotation.y = -s.ch[0].vdiv * 0.5; kb.v2.rotation.y = -s.ch[1].vdiv * 0.5; kb.t.rotation.y = -s.tdiv * 0.3;
    kb.lvl.rotation.y = -s.trig.level; kb.p1.rotation.y = -s.ch[0].pos; kb.p2.rotation.y = -s.ch[1].pos;
  };
  dev.status = () => {
    if (!s.power) return '电源关';
    const u = eng.uncal();
    const chs = (i) => `CH${i + 1} ${fmtV(VDIV[s.ch[i].vdiv])}/div${u.y[i] ? '(非校准)' : ''} ${s.ch[i].cpl}${i && s.ch[1].inv ? ' 反相' : ''}`;
    const mode = { CH1: chs(0), CH2: chs(1), DUAL: `${chs(0)} · ${chs(1)}`, ADD: `${chs(0)} + ${chs(1)}`, XY: `X-Y：X=${chs(0)}  Y=${chs(1)}` }[s.mode];
    if (s.mode === 'XY') return mode;
    return `${mode} · ${fmtT(TDIV[s.tdiv])}/div${s.mag ? ' ×10' : ''}${u.x ? '(非校准)' : ''} · 触发 CH${s.trig.src + 1} ${s.trig.slope > 0 ? '↑' : '↓'} ${s.trig.mode}${eng.triggered ? ' · 已触发' : s.trig.mode === 'AUTO' ? ' · 自激' : ' · 无触发'}${dev.busy ? ' · 计算中…' : ''}`;
  };

  const pct = (v) => `${Math.round(v * 100)}%`;
  dev.comp = new Component({
    key, name, icon: OSC_ICON, zone: 'slot', defaultSlot, object: g, labelY: 19,
    desc: '模拟双踪示波器，带宽 20 MHz。输入阻抗 1 MΩ ∥ 20 pF；交流耦合电容 0.047 μF（下限频率约 3.4 Hz）。偏转因数 5 mV/div – 5 V/div（1-2-5 步进），扫描时间 0.1 μs/div – 0.5 s/div，可 ×10 扩展。“微调”离开校准位置时读数不准（非校准）。“⊥”端经电源插头接地，与信号发生器的地相通。',
    controls: () => [
      { type: 'toggle', label: '电源 POWER', get: () => s.power, set: (v) => (s.power = v) },
      { type: 'group', label: '显示' },
      { type: 'knob', label: '辉度 INTEN', get: () => s.inten, set: (v) => (s.inten = clamp(v, 0, 1)), min: 0, max: 1, step: 0.02, bigStep: 0.1, perRev: 1, fmt: pct },
      { type: 'knob', label: '聚焦 FOCUS', get: () => s.focus, set: (v) => (s.focus = clamp(v, 0, 1)), min: 0, max: 1, step: 0.01, bigStep: 0.1, perRev: 1, fmt: pct },
      { type: 'group', label: '垂直系统' },
      { type: 'segment', label: '垂直方式 MODE', options: [{ value: 'CH1', label: 'CH1' }, { value: 'CH2', label: 'CH2' }, { value: 'DUAL', label: '双踪' }, { value: 'ADD', label: '叠加' }, { value: 'XY', label: 'X-Y' }], get: () => s.mode, set: (v) => (s.mode = v) },
      ...[0, 1].flatMap((i) => [
        stepKnob(`CH${i + 1} 偏转因数 VOLTS/DIV`, () => s.ch[i].vdiv, (v) => (s.ch[i].vdiv = v), VDIV.length, (k) => `${fmtV(VDIV[k])}/div`),
        { type: 'knob', label: `CH${i + 1} 微调 VAR`, get: () => s.ch[i].var, set: (v) => (s.ch[i].var = clamp(v, 0.4, 1)), min: 0.4, max: 1, step: 0.01, bigStep: 0.1, perRev: 1, fmt: (v) => (v >= 0.999 ? '校准 CAL' : `×${v.toFixed(2)} 非校准`) },
        { type: 'knob', label: `CH${i + 1} 垂直位移 POSITION`, get: () => s.ch[i].pos, set: (v) => (s.ch[i].pos = clamp(v, -6, 6)), min: -6, max: 6, step: 0.02, bigStep: 0.5, perRev: 4, digits: 2, unit: 'div' },
        { type: 'segment', label: `CH${i + 1} 耦合`, options: [{ value: 'AC', label: 'AC' }, { value: 'GND', label: 'GND' }, { value: 'DC', label: 'DC' }], get: () => s.ch[i].cpl, set: (v) => (s.ch[i].cpl = v) },
        ...(i ? [{ type: 'toggle', label: 'CH2 反相 INV', get: () => s.ch[1].inv, set: (v) => (s.ch[1].inv = v) }] : []),
      ]),
      { type: 'group', label: '水平系统' },
      stepKnob('扫描时间 TIME/DIV', () => s.tdiv, (v) => (s.tdiv = v), TDIV.length, (k) => `${fmtT(TDIV[k])}/div`),
      { type: 'knob', label: '扫描微调 VAR', get: () => s.tvar, set: (v) => (s.tvar = clamp(v, 0.4, 1)), min: 0.4, max: 1, step: 0.01, bigStep: 0.1, perRev: 1, fmt: (v) => (v >= 0.999 ? '校准 CAL' : `×${v.toFixed(2)} 非校准`) },
      { type: 'knob', label: '水平位移 POSITION', get: () => s.xpos, set: (v) => (s.xpos = clamp(v, -8, 8)), min: -8, max: 8, step: 0.02, bigStep: 0.5, perRev: 4, digits: 2, unit: 'div' },
      { type: 'toggle', label: '扫描扩展 ×10 MAG', get: () => s.mag, set: (v) => (s.mag = v) },
      { type: 'group', label: '触发' },
      { type: 'segment', label: '触发源 SOURCE', options: [{ value: 0, label: 'CH1' }, { value: 1, label: 'CH2' }], get: () => s.trig.src, set: (v) => (s.trig.src = v) },
      { type: 'segment', label: '触发极性 SLOPE', options: [{ value: 1, label: '+ 上升沿' }, { value: -1, label: '− 下降沿' }], get: () => s.trig.slope, set: (v) => (s.trig.slope = v) },
      { type: 'knob', label: '触发电平 LEVEL', get: () => s.trig.level, set: (v) => (s.trig.level = clamp(v, -4, 4)), min: -4, max: 4, step: 0.02, bigStep: 0.25, perRev: 4, digits: 2, unit: 'div' },
      { type: 'segment', label: '触发方式', options: [{ value: 'AUTO', label: 'AUTO 自动' }, { value: 'NORM', label: 'NORM 常态' }], get: () => s.trig.mode, set: (v) => (s.trig.mode = v) },
      { type: 'readout', label: '状态', get: () => (!s.power ? '电源关' : s.mode === 'XY' ? 'X-Y 方式（不扫描）' : eng.triggered ? 'TRIG’D 已触发，波形稳定' : s.trig.mode === 'AUTO' ? '未触发：自激扫描，波形不稳定' : '未触发：无扫描线') },
    ],
  });
  return dev;
}
const OSC_ICON = '<svg viewBox="0 0 64 40"><rect x="4" y="5" width="56" height="30" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="8" y="9" width="26" height="20" fill="none" stroke="currentColor"/><path d="M10 19q3-7 6 0t6 0t6 0t5 0" fill="none" stroke="#16a34a" stroke-width="1.4"/><circle cx="42" cy="15" r="3" fill="none" stroke="currentColor"/><circle cx="52" cy="15" r="3" fill="none" stroke="currentColor"/><circle cx="47" cy="26" r="2.5" fill="none" stroke="currentColor"/></svg>';

/** 内刻度：10×8 大格，中心轴每大格 5 小格；0% 与 100% 虚线相距 5 格，10%/90% 相距 4 格（测上升时间用） */
export function drawGraticule(c, x, y, div, a = 0.3) {
  c.save();
  c.strokeStyle = `rgba(170,210,190,${a})`; c.lineWidth = 0.7;
  c.beginPath();
  for (let i = 0; i <= 10; i++) { c.moveTo(x + i * div, y); c.lineTo(x + i * div, y + 8 * div); }
  for (let j = 0; j <= 8; j++) { c.moveTo(x, y + j * div); c.lineTo(x + 10 * div, y + j * div); }
  c.stroke();
  c.beginPath();
  const cx = x + 5 * div, cy = y + 4 * div;
  for (let i = 0; i <= 50; i++) { const px = x + (i * div) / 5; c.moveTo(px, cy - 3); c.lineTo(px, cy + 3); }
  for (let j = 0; j <= 40; j++) { const py = y + (j * div) / 5; c.moveTo(cx - 3, py); c.lineTo(cx + 3, py); }
  c.stroke();
  c.setLineDash([2, 3]);
  c.beginPath();
  for (const yy of [1.5, 2.0, 6.0, 6.5]) { c.moveTo(x, y + yy * div); c.lineTo(x + 10 * div, y + yy * div); }
  c.stroke(); c.setLineDash([]);
  c.fillStyle = `rgba(170,210,190,${a * 1.4})`; c.font = `${div * 0.24}px Arial`;
  c.fillText('100%', x + 2, y + 1.5 * div - 2); c.fillText('90', x + 2, y + 2.0 * div - 2); c.fillText('10', x + 2, y + 6.0 * div - 2); c.fillText('0%', x + 2, y + 6.5 * div - 2);
  c.restore();
}

/** 电容箱（十进式，0.001–1.111 μF） */
export function capacitorBox({ key = 'cbox', name = '电容箱', defaultSlot, C = 0.1e-6, cls = 0.5 }) {
  const W = 18, D = 12, Hh = 5;
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(W, Hh, D), MAT.paint(0x2b3a4a), 0, Hh / 2, 0));
  g.add(mesh(new THREE.BoxGeometry(W + 0.4, 0.6, D + 0.4), MAT.paint(0x3a2a1a), 0, Hh + 0.3, 0));
  const steps = [0.001e-6, 0.01e-6, 0.1e-6, 1e-6];
  const dials = steps.map((_, i) => { const d = mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.7, 24), MAT.black(), -W / 2 + 3 + i * 4, Hh + 0.95, -1); g.add(d); return d; });
  const lab = panelMesh(W, 2, (c, w, h) => { c.fillStyle = '#3a2a1a'; c.fillRect(0, 0, w, h); c.fillStyle = '#f0e6c8'; c.font = `bold ${h * 0.5}px Arial`; c.textAlign = 'center'; c.textBaseline = 'middle'; ['×0.001', '×0.01', '×0.1', '×1 μF'].forEach((s, i) => c.fillText(s, ((3 + i * 4) / W) * w, h / 2)); });
  lab.rotation.x = -Math.PI / 2; lab.position.set(0, Hh + 0.62, 2.2); g.add(lab);
  const err = 1 + (rand(-1, 1) * cls * 0.6) / 100;
  const dev = {
    key, short: name, d: [0, 0, 0, 0],
    terms: { a: { pos: new THREE.Vector3(W / 2 - 4.5, Hh + 0.6, D / 2 - 1.5), label: 'a', color: 0x1b1b1b }, b: { pos: new THREE.Vector3(W / 2 - 1.6, Hh + 0.6, D / 2 - 1.5), label: 'b', color: 0x1b1b1b } },
    nominal() { return this.d.reduce((s, v, i) => s + v * steps[i], 0); },
    value() { return this.nominal() * err + 5e-12; },
    set(Cv) { let r = Math.round(Cv / 0.001e-6); for (let i = 0; i < 3; i++) { this.d[i] = r % 10; r = Math.floor(r / 10); } this.d[3] = Math.min(1, r); },
    ac(t) { return [{ type: 'C', a: t('a'), b: t('b'), C: this.value() }, { type: 'R', a: t('a'), b: t('b'), R: 5e9 }]; },
    elements() { return []; },
    after() { dials.forEach((m, i) => (m.rotation.y = -(this.d[i] / 10) * Math.PI * 2)); },
  };
  dev.set(C);
  dev.comp = new Component({
    key, name, icon: CBOX_ICON, zone: 'slot', defaultSlot, object: g, labelY: 11,
    desc: `十进式电容箱，0–1.999 μF，最小步进 0.001 μF，准确度 ${cls} 级，分布电容约 5 pF。`,
    controls: () => [
      { type: 'readout', label: '示值', get: () => `${(dev.nominal() * 1e6).toFixed(3)} μF` },
      ...['×0.001 μF', '×0.01 μF', '×0.1 μF', '×1 μF'].map((l, i) => ({ type: 'knob', label: l, get: () => dev.d[i], set: (v) => (dev.d[i] = i === 3 ? clamp(Math.round(v), 0, 1) : ((Math.round(v) % 10) + 10) % 10), min: 0, max: i === 3 ? 1 : 9, step: 1, bigStep: 1, perRev: 10, digits: 0, wrap: i === 3 ? undefined : 10, unit: '' })),
    ],
  });
  return dev;
}
const CBOX_ICON = '<svg viewBox="0 0 64 40"><rect x="6" y="6" width="52" height="28" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M18 20h10M36 20h10M28 13v14M36 13v14" stroke="currentColor" stroke-width="1.8"/></svg>';

/** 电感线圈（带直流电阻） */
export function inductor({ key = 'ind', name = '电感线圈', defaultSlot, L = 10e-3, R = 25, tol = 0.02 }) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(10, 1, 7), MAT.paint(0x1d3b2a), 0, 0.5, 0));
  const coil = mesh(new THREE.CylinderGeometry(2.2, 2.2, 3.4, 28), MAT.paint(0xb4652a), 0, 2.7, -0.6); g.add(coil);
  g.add(mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.4, 28), MAT.black(), 0, 1.1, -0.6));
  g.add(mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.4, 28), MAT.black(), 0, 4.5, -0.6));
  const plate = `${+(L * 1e3).toPrecision(3)} mH ±${tol * 100}%  ${R.toFixed(1)} Ω`;
  const lab = panelMesh(9, 1.6, (c, w, h) => { c.fillStyle = '#1d3b2a'; c.fillRect(0, 0, w, h); c.fillStyle = '#e8e4d8'; c.font = `bold ${h * 0.5}px Arial`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(plate, w / 2, h / 2); });
  lab.rotation.x = -Math.PI / 2; lab.position.set(0, 1.02, 2.6); g.add(lab);
  const dev = {
    key, short: name, Lnom: L, L: L * (1 + rand(-tol, tol)), R,
    terms: { a: { pos: new THREE.Vector3(-3.8, 1, 2.4), label: '1', color: 0x1b1b1b }, b: { pos: new THREE.Vector3(3.8, 1, 2.4), label: '2', color: 0x1b1b1b } },
    ac(t) { return [{ type: 'L', a: t('a'), b: t('_m'), L: this.L }, { type: 'R', a: t('_m'), b: t('b'), R: this.R }, { type: 'C', a: t('a'), b: t('b'), C: 30e-12 }]; },
    elements(t) { return [{ type: 'R', a: t('a'), b: t('b'), R: this.R }]; },
  };
  dev.comp = new Component({ key, name, icon: CBOX_ICON.replace('M18 20h10M36 20h10M28 13v14M36 13v14', 'M12 20h6q3-8 6 0q3-8 6 0q3-8 6 0q3-8 6 0h6'), zone: 'slot', defaultSlot, object: g, labelY: 9, desc: `空心电感线圈。铭牌：电感 ${+(L * 1e3).toPrecision(3)} mH（±${tol * 100}%），直流电阻 ${R.toFixed(1)} Ω（出厂实测）。分布电容约 30 pF。` });
  return dev;
}
