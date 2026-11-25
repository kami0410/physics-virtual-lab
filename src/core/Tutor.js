// 实验助教：学生卡住时，读出实验的当前状态，指出是哪里不对，并且只把出问题的那一项调好（学生能看到旋钮被转动），
// 而不是把整步都替他做完。两层：
//   1. 本地诊断（离线可用）：每个实验可以给步骤写 diagnose()，返回 [{msg, fix:{label, run}}]；
//      另有通用检查：必需器材没放、读数没填、最近的仪器警告、步骤完成条件。
//   2. 大模型对话（可选，用户自己接入任何一种格式的服务）：模型通过工具读状态、调旋钮、放器材、执行修正。
import { h } from './Controls.js';
import { renderMath } from './tex.js';

const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\$+/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const norm = (s) => strip(s).replace(/[\s（）()：:，,。·\-—_/]/g, '').toLowerCase();
const fmtNum = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? v : +v.toPrecision(5)) : v);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const ICON = '<svg class="i" viewBox="0 0 16 16"><path d="M3 12.5V4.5a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 13 4.5v5a1.5 1.5 0 0 1-1.5 1.5H6.5L3 13.5z"/><path d="M6 6.2h4M6 8.4h2.6"/></svg>';

export const TOOLS = [
  { name: 'get_state', description: '读取实验当前状态：当前步骤和完成条件、每个仪器的可调参数和当前值、数据表填写情况、最近的仪器提示、本地诊断结果（diagnosis，带 fix 的条目可以用 apply_fix 执行）。', params: {} },
  { name: 'get_history', description: '读取学生从开始到现在的操作轨迹（按时间顺序）：调过哪些参数、从多少调到多少、放取了哪些器材、记录了哪些数据、在哪一步出现过什么仪器警告、哪些步骤是自动完成的。用来判断学生是怎么走到现在这个状态的、哪一步操作导致了问题。', params: { last: '最多返回多少条，默认 60' } },
  { name: 'set_control', description: '把某个仪器的一个可调参数调到指定值，学生能看到旋钮被转过去。component 用 get_state 里仪器的 key（“测量与读数”面板用 global），control 用参数名称。一次只调确实有问题的那一项。', params: { component: '仪器的 key 或名称；测量与读数面板写 global', control: '参数名称（get_state 中 controls 的 label）', value: '目标值：数值（不带单位）、选项文字，或 开 / 关' } },
  { name: 'press_button', description: '按下仪器或测量面板上的一个按钮（如“开始测量”“记录”之类的操作按钮）。', params: { component: '仪器 key 或 global', button: '按钮文字' } },
  { name: 'place_component', description: '把器材柜里的一件器材放到实验台上它的标准位置。', params: { component: '器材 key 或名称' } },
  { name: 'apply_fix', description: '执行本地诊断 diagnosis 列表中第 index 条的修正（从 0 开始，只有带 fix 的条目可以执行）。', params: { index: '条目序号，如 0' } },
  { name: 'show_component', description: '选中并高亮一个仪器，打开它的调节面板，让学生看清你说的是哪一个。', params: { component: '仪器 key 或名称' } },
  { name: 'take_over_step', description: '让程序按规范操作自动完成当前这一步（会先把前面被改乱的设置恢复）。只在学生明确要求，或者你调了几次仍然不行时使用。', params: {} },
];

export class Tutor {
  constructor(app) {
    this.app = app;
    this.warns = []; this.acts = [];
    this.stepT0 = performance.now(); this.lastStep = 0; this.autoFailed = false;
    this.open = false; this.busy = false; this.chatLog = [];
    this.hist = []; this.lastVal = new Map(); this.railPos = new Map(); this.t0 = performance.now();
    const ot = app.toast.bind(app);
    app.toast = (m, k) => {
      if (k === 'warn' || k === 'bad') { this.warns.push({ t: performance.now(), step: app.stepIdx, msg: strip(m) }); if (this.warns.length > 30) this.warns.shift(); if (!app.running) this.event(`仪器提示：${strip(m)}`, 'warn'); }
      return ot(m, k);
    };
  }

  // ======================= 操作轨迹 =======================
  // 学生做过什么：调节（同一参数连续调节合并为“从 a 调到 b”）、放取器材、记录数据、步骤完成、仪器警告。
  // 助教据此判断学生是怎么走到现在这一步的，而不只是看此刻的状态。
  keyOf(c, d) { return `${c === 'global' ? 'global' : c.key}|${strip(d.label)}`; }
  seed(c, descs) { for (const d of descs) if (d && d.get && d.type !== 'button') { const k = this.keyOf(c, d); if (!this.lastVal.has(k)) { try { this.lastVal.set(k, this.descOf(d).value); } catch { /* 忽略 */ } } } }
  stamp() { const s = Math.round((performance.now() - this.t0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
  push(e) { e.t = performance.now(); e.at = this.stamp(); e.step = this.app.stepIdx + 1; this.hist.push(e); if (this.hist.length > 300) this.hist.splice(0, this.hist.length - 300); }
  event(text, kind = 'ev') {
    const last = this.hist[this.hist.length - 1];
    if (last && last.text === text && performance.now() - last.t < 4000) { last.n = (last.n || 1) + 1; return; }
    this.push({ kind, text });
  }
  track(c, d) {
    if (this.app.running || !d || d.type === 'readout') return;
    const who = c === 'global' ? '测量与读数' : strip(c.name), label = strip(d.label);
    if (d.type === 'button') { this.event(`按「${who} · ${label}」`); return; }
    const k = this.keyOf(c, d), to = this.descOf(d).value, last = this.hist[this.hist.length - 1];
    if (last && last.key === k && performance.now() - last.t < 4000) { last.to = to; last.t = performance.now(); last.text = `「${who} · ${label}」${last.from} → ${to}${d.unit ? ' ' + strip(d.unit) : ''}`; }
    else { const from = this.lastVal.has(k) ? this.lastVal.get(k) : '?'; this.push({ kind: 'adj', key: k, ck: c === 'global' ? 'global' : c.key, who, label, unit: d.unit ? strip(d.unit) : '', from, to, text: `「${who} · ${label}」${from} → ${to}${d.unit ? ' ' + strip(d.unit) : ''}` }); }
    this.lastVal.set(k, to);
  }
  /** 在场景里拖动导轨上的器材不经过控件，靠轮询发现 */
  pollRail() {
    const a = this.app;
    for (const c of a.comps.values()) {
      if (!c.placed || c.zone !== 'rail') { this.railPos.delete(c.key); continue; }
      const p = +c.pos.toFixed(2), was = this.railPos.get(c.key);
      if (was != null && Math.abs(was - p) > 0.004 && !a.running) this.track(c, { type: 'knob', label: '导轨位置（滑座刻线）', get: () => c.pos, unit: 'cm' });
      this.railPos.set(c.key, p);
    }
  }
  history(n = 40) {
    return this.hist.slice(-n).map((e) => `[${e.at} 第${e.step}步] ${e.text}${e.n > 1 ? ` ×${e.n}` : ''}`);
  }

  // ======================= 状态快照 =======================
  /** 仪器调节面板里出现的全部控件（与 renderInspector 一致） */
  controlsOf(c) {
    const a = this.app;
    if (c === 'global') return a.exp.globalControls ? a.exp.globalControls() : [];
    const out = [];
    if (c.zone === 'rail' && c.movable) out.push({ type: 'knob', label: '导轨位置（滑座刻线）', get: () => c.pos, set: (v) => a.setRailPos(c, v), unit: 'cm' });
    if (a.coax && !a.running) out.push(...a.coax.controls(c));
    if (a.isFree(c) && !a.running) out.push(
      { type: 'knob', label: '底座 左右（x）', get: () => c.tx, set: (v) => a.setPose(c, v, c.tz), unit: 'cm' },
      { type: 'knob', label: '底座 前后（z）', get: () => c.tz, set: (v) => a.setPose(c, c.tx, v), unit: 'cm' },
      { type: 'knob', label: '底座转角', get: () => c.rot, set: (v) => a.setPose(c, c.tx, c.tz, v), unit: '°' },
    );
    out.push(...(c.controls ? c.controls() : []));
    return out.filter((d) => d && d.type && !['note', 'group'].includes(d.type));
  }
  descOf(d) {
    const o = { label: strip(d.label), type: d.type };
    try {
      if (d.type === 'button') return o;
      const v = d.get ? d.get() : undefined;
      if (d.type === 'select' || d.type === 'segment') { const op = (d.options || []).find((x) => x.value === v || String(x.value) === String(v)); o.value = op ? strip(op.label) : fmtNum(v); o.options = (d.options || []).map((x) => strip(x.label)); }
      else if (d.type === 'toggle') o.value = v ? '开' : '关';
      else if (d.type === 'readout') o.value = strip(v);
      else { o.value = fmtNum(v); if (d.min != null) o.min = fmtNum(d.min); if (d.max != null) o.max = fmtNum(d.max); if (d.unit) o.unit = strip(d.unit); if (d.fmt) { const f = strip(d.fmt(v)); if (f && f !== String(o.value)) o.shown = f; } }
    } catch (err) { o.error = err.message; }
    return o;
  }
  snapshot() {
    const a = this.app, i = a.stepIdx, s = a.steps[i];
    const safe = (f) => { try { return f(); } catch { return null; } };
    const comps = [...a.comps.values()].map((c) => ({
      key: c.key, name: strip(c.name), placed: !!c.placed, ...(c.required ? { required: true } : {}),
      ...(c.placed ? { controls: this.controlsOf(c).map((d) => this.descOf(d)) } : {}),
    }));
    const tables = a.tables.map((t) => {
      let filled = 0, cells = 0, pend = 0;
      for (const r of t.rows) for (const col of t.spec.columns) { if (col.calc || col.readonly || col.type === 'text') continue; cells++; if (t.isPend(r, col.key)) pend++; else if (r[col.key] != null && r[col.key] !== '' && !(typeof r[col.key] === 'number' && !isFinite(r[col.key]))) filled++; }
      return { id: t.id, title: strip(t.spec.title), rows: t.rows.length, filledCells: filled, emptyCells: cells - filled - pend, waitingStudentReading: pend, buttons: (t.spec.buttons || []).map((b) => strip(b.label)) };
    });
    return {
      experiment: { id: a.meta.id, title: a.meta.title },
      step: s ? { index: i + 1, total: a.steps.length, title: strip(s.title), instructions: strip(s.html), hint: strip(s.hint), status: s.status ? strip(safe(() => a.studentView(() => s.status()))) : '', passed: !!safe(() => a.studentView(() => s.check && s.check())), minutesOnStep: +((performance.now() - this.stepT0) / 60000).toFixed(1) } : { done: true },
      steps: a.steps.map((x, k) => `${k + 1}.${strip(x.title)}${a.stepDone[k] ? '✓' : ''}`),
      components: comps,
      global: this.controlsOf('global').map((d) => this.descOf(d)),
      tables,
      recentWarnings: this.warns.filter((w) => performance.now() - w.t < 180000).slice(-6).map((w) => w.msg),
      studentHistory: this.history(15),
      tutorActions: this.acts.slice(-6),
      diagnosis: this.diagnose().map((d, k) => ({ index: k, msg: d.msg, ...(d.fix ? { fix: d.fix.label } : {}) })),
      autoRunning: a.running,
    };
  }

  // ======================= 本地诊断 =======================
  diagnose() {
    const a = this.app, s = a.steps[a.stepIdx], out = [];
    if (!s) return [{ msg: '全部步骤已经完成，可以做数据处理、写实验报告了。' }];
    if (s.diagnose) { try { for (const d of s.diagnose() || []) if (d && d.msg) out.push(d); } catch (err) { console.warn(err); } }
    for (const c of a.comps.values()) if (c.required && !c.placed) out.push({ msg: `「${strip(c.name)}」还在器材柜里，没有放上实验台。`, fix: { label: '帮我放好', run: () => a.autoPlace(c.key) } });
    // 学生在本步的最近几次调节：本步没通过时，可以一键撤回（把旋钮转回去）
    let passed0 = false;
    try { passed0 = !!a.studentView(() => s.check && s.check()); } catch { /* 忽略 */ }
    if (!passed0) {
      const seen = new Set();
      for (const e of this.hist.slice().reverse()) {
        if (e.step !== a.stepIdx + 1 || e.kind !== 'adj' || seen.has(e.key) || e.from === '?' || String(e.from) === String(e.to) || seen.size >= 3) continue;
        seen.add(e.key);
        out.push({ msg: `你在 ${e.at} 把「${e.who} · ${e.label}」从 ${e.from} 调到了 ${e.to}${e.unit ? ' ' + e.unit : ''}。如果是这一下把现象弄没了，可以撤回。`, fix: { label: '撤回这一下', run: () => this.setControl(e.ck, e.label, String(e.from)) } });
      }
    }
    let pend = 0;
    for (const t of a.tables) for (const r of t.rows) if (t.hasPend(r)) pend += Object.keys(r._pend).length;
    if (pend) out.push({ msg: `数据表里还有 ${pend} 个读数等你自己读出来填上（高亮的格子）。读仪器时注意估读一位。` });
    const st = s.status ? strip(a.studentView(() => s.status())) : '';
    let passed = false;
    try { passed = !!a.studentView(() => s.check && s.check()); } catch { /* 忽略 */ }
    if (st && !out.length) out.push({ msg: `本步的完成条件：${st}` });
    else if (!passed && !out.length && s.check) out.push({ msg: `本步的完成条件还没满足。本步要求：${strip(s.html).slice(0, 160)}` });
    const ws = [...new Set(this.warns.filter((w) => w.step === a.stepIdx).slice(-3).map((w) => w.msg))];
    for (const w of ws) out.push({ msg: `仪器刚才提示：${w}` });
    return out;
  }

  // ======================= 动作（本地按钮与大模型工具共用） =======================
  findComp(q) {
    if (q == null || q === '' || /^(global|测量|读数)/i.test(String(q).trim())) return 'global';
    const a = this.app, n = norm(q);
    const cs = [...a.comps.values()];
    return cs.find((c) => c.key === q) || cs.find((c) => norm(c.name) === n) || cs.find((c) => norm(c.name).includes(n) || n.includes(norm(c.name))) || null;
  }
  findCtl(list, q) {
    const n = norm(q);
    return list.find((d) => strip(d.label) === strip(q)) || list.find((d) => norm(d.label) === n) || list.find((d) => norm(d.label).includes(n)) || list.find((d) => n.includes(norm(d.label)) && norm(d.label).length > 1) || null;
  }
  ready() {
    const a = this.app;
    if (a.running) throw new Error('自动演示正在进行，等它结束或先停止');
    a._abort = false;
  }
  log(text) { this.acts.push(text); if (this.acts.length > 20) this.acts.shift(); this.say(text, 'act'); }
  async setControl(compQ, ctlQ, value) {
    this.ready();
    const a = this.app, c = this.findComp(compQ);
    if (!c) throw new Error(`找不到仪器「${compQ}」`);
    if (c !== 'global' && !c.placed) throw new Error(`「${strip(c.name)}」还没放上实验台`);
    const list = this.controlsOf(c), d = this.findCtl(list, ctlQ);
    if (!d) throw new Error(`「${c === 'global' ? '测量与读数' : strip(c.name)}」没有叫「${ctlQ}」的参数；可调的有：${list.filter((x) => x.set).map((x) => strip(x.label)).join('、')}`);
    if (!d.set) throw new Error(`「${strip(d.label)}」只能读，不能调`);
    if (c !== 'global' && a.selected !== c) a.select(c);
    const before = this.descOf(d).value;
    if (d.type === 'knob' || d.type === 'slider') {
      let v = parseFloat(String(value).replace(/[^\d.eE+\-−]/g, '').replace('−', '-'));
      if (!isFinite(v)) throw new Error(`「${value}」不是数值`);
      if (d.min != null) v = Math.max(d.min, v);
      if (d.max != null) v = Math.min(d.max, v);
      const from = +d.get();
      if (isFinite(from) && !d.wrap) await a.tween(() => +d.get(), (x) => d.set(x), v, 800);
      d.set(v);
    } else if (d.type === 'toggle') d.set(/^(1|true|on|开|是|打开|闭合|接通)/i.test(String(value).trim()));
    else if (d.type === 'select' || d.type === 'segment') {
      const vs = String(value).trim(), ops = d.options || [];
      const op = ops.find((o) => strip(o.label) === vs) || ops.find((o) => String(o.value) === vs) || ops.find((o) => norm(o.label).includes(norm(vs))) || ops.find((o) => norm(vs).includes(norm(o.label)));
      if (!op) throw new Error(`「${strip(d.label)}」没有选项「${vs}」；可选：${ops.map((o) => strip(o.label)).join('、')}`);
      d.set(op.value);
    } else throw new Error(`「${strip(d.label)}」不是可调参数`);
    a.changed(); a.renderInspector();
    const after = this.descOf(d).value;
    this.log(`把「${c === 'global' ? '' : strip(c.name) + ' · '}${strip(d.label)}」从 ${before} 调到 ${after}${d.unit ? ' ' + strip(d.unit) : ''}`);
    return { ok: true, control: strip(d.label), from: before, to: after };
  }
  async pressButton(compQ, btnQ) {
    this.ready();
    const a = this.app, c = this.findComp(compQ);
    if (!c) throw new Error(`找不到仪器「${compQ}」`);
    const list = this.controlsOf(c).filter((d) => d.type === 'button');
    let d = this.findCtl(list, btnQ);
    if (!d) {
      // 也可以是数据表旁的记录按钮
      for (const t of a.tables) { const b = (t.spec.buttons || []).find((b) => norm(b.label).includes(norm(btnQ))); if (b) { a.showTable(a.tables.indexOf(t)); b.onClick(t); a.changed(); this.log(`按下「${strip(b.label)}」`); return { ok: true }; } }
      throw new Error(`没有找到按钮「${btnQ}」；可按的有：${list.map((x) => strip(x.label)).join('、') || '（无）'}`);
    }
    if (c !== 'global' && a.selected !== c) a.select(c);
    d.onClick(); a.changed(); a.renderInspector();
    this.log(`按下「${strip(d.label)}」`);
    return { ok: true };
  }
  async place(compQ) {
    this.ready();
    const c = this.findComp(compQ);
    if (!c || c === 'global') throw new Error(`找不到器材「${compQ}」`);
    if (c.placed) return { ok: true, note: '已经在实验台上了' };
    await this.app.autoPlace(c.key);
    this.log(`把「${strip(c.name)}」放上实验台`);
    return { ok: !!c.placed };
  }
  async applyFix(k) {
    this.ready();
    const d = this.diagnose()[+k];
    if (!d || !d.fix) throw new Error('这一条没有可以执行的修正');
    await d.fix.run();
    this.app.changed(); this.app.renderInspector();
    this.log(`${d.fix.label}：${d.msg}`);
    return { ok: true };
  }
  show(compQ) {
    const c = this.findComp(compQ);
    if (!c || c === 'global' || !c.placed) throw new Error(`「${compQ}」不在实验台上`);
    this.app.select(c);
    return { ok: true };
  }
  async takeOver() {
    const a = this.app;
    if (a.running) throw new Error('自动演示正在进行');
    const i = a.stepIdx;
    if (i >= a.steps.length) return { ok: true, note: '全部步骤已完成' };
    this.log(`接手第 ${i + 1} 步「${strip(a.steps[i].title)}」`);
    await a.runStep(i);
    return { ok: !!a.stepDone[i] };
  }
  async runTool(name, args) {
    const g = (k) => (args && args[k] != null ? String(args[k]) : '');
    switch (name) {
      case 'get_state': return this.snapshot();
      case 'get_history': return { history: this.history(Math.min(200, +g('last') || 60)), totalEvents: this.hist.length };
      case 'set_control': return this.setControl(g('component'), g('control'), g('value'));
      case 'press_button': return this.pressButton(g('component'), g('button'));
      case 'place_component': return this.place(g('component'));
      case 'apply_fix': return this.applyFix(g('index'));
      case 'show_component': return this.show(g('component'));
      case 'take_over_step': return this.takeOver();
      default: throw new Error(`没有工具 ${name}`);
    }
  }

  // ======================= 卡住检测 =======================
  tick() {
    const a = this.app;
    this.pollRail();
    if (a.stepIdx !== this.lastStep) { this.lastStep = a.stepIdx; this.stepT0 = performance.now(); this.autoFailed = false; this.setNudge(false); if (this.open) this.renderDiag(); return; }
    if (a.running || this.open || a.stepIdx >= a.steps.length) return;
    const mins = (performance.now() - this.stepT0) / 60000;
    const nw = this.warns.filter((w) => w.step === a.stepIdx && performance.now() - w.t < 120000).length;
    this.setNudge(this.autoFailed || nw >= 3 || mins > 4);
  }
  setNudge(on) {
    if (!this.btn || this._nudge === on) return;
    this._nudge = on;
    this.btn.classList.toggle('nudge', on);
    this.btn.title = on ? '看起来这一步卡住了——助教可以看看哪里不对' : '助教：看看现在哪里不对，或者问问题';
  }
  onAutoFail() { this.autoFailed = true; this.setNudge(true); if (this.open) this.renderDiag(); }

  // ======================= 面板 =======================
  mount(btn) {
    this.btn = btn;
    btn.onclick = () => this.toggle();
    this.setNudge(false);
  }
  toggle(force) {
    this.open = force ?? !this.open;
    if (this.open) { this.build(); this.setNudge(false); } else if (this.el) { this.el.remove(); this.el = null; }
    this.btn && this.btn.classList.toggle('active', this.open);
  }
  build() {
    const a = this.app;
    if (this.el) this.el.remove();
    const el = h('div', 'tutor');
    el.innerHTML = `<div class="tt-h"><span class="tt-mark">${ICON}</span><div class="tt-ht"><b>助教</b><small data-st></small></div><button class="btn small ghost" data-cfg title="接入大模型">设置</button><button class="btn small ghost" data-x title="关闭">✕</button></div>
      <div class="tt-body"><section class="tt-diag"></section><section class="tt-chat"></section></div>
      <form class="tt-in"><textarea rows="2" placeholder="问助教，比如：为什么条纹不清楚？下一步该调哪个旋钮？"></textarea><button class="btn ink" type="submit">发送</button></form>`;
    a.vp.append(el);
    this.el = el;
    el.querySelector('[data-x]').onclick = () => this.toggle(false);
    el.querySelector('[data-cfg]').onclick = () => this.settings();
    const ta = el.querySelector('textarea');
    el.querySelector('form').onsubmit = (e) => { e.preventDefault(); const q = ta.value.trim(); if (q) { ta.value = ''; this.ask(q); } };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); el.querySelector('form').requestSubmit(); } });
    this.chatEl = el.querySelector('.tt-chat');
    for (const m of this.chatLog) this.chatEl.append(this.bubble(m.role, m.html));
    this.renderDiag();
    this.renderChatNote();
  }
  renderDiag() {
    if (!this.el) return;
    const a = this.app, s = a.steps[a.stepIdx];
    this.el.querySelector('[data-st]').textContent = s ? `第 ${a.stepIdx + 1} / ${a.steps.length} 步 · ${strip(s.title)}` : '全部步骤已完成';
    const box = this.el.querySelector('.tt-diag');
    box.innerHTML = `<div class="tt-sec">现在的情况</div>`;
    const ds = this.diagnose();
    if (this.autoFailed) ds.unshift({ msg: '“自动完成”没能做完这一步：多半是前面某个设置被改动了，程序按标准流程操作时对不上。下面逐条检查；也可以让助教接手，它会先把前面的设置恢复。' });
    if (!ds.length) ds.push({ msg: s ? '没有发现明显的问题。看看本步说明里的要求，或者点“提示”。' : '全部完成。' });
    const ul = h('ol', ds.length > 1 ? 'tt-list' : 'tt-list one');
    ds.forEach((d) => {
      const li = h('li', null, `<span>${renderMath(esc(d.msg))}</span>`);
      if (d.fix) {
        const b = h('button', 'btn small', d.fix.label);
        b.onclick = async () => { b.disabled = true; try { this.ready(); await d.fix.run(); a.changed(); a.renderInspector(); this.log(`${d.fix.label}：${d.msg}`); } catch (err) { this.say(err.message, 'err'); } finally { setTimeout(() => this.renderDiag(), 300); } };
        li.append(b);
      }
      ul.append(li);
    });
    box.append(ul);
    if (s) {
      const acts = h('div', 'tt-acts');
      const hint = h('button', 'btn small', '看本步提示');
      hint.onclick = () => this.say(strip(s.hint) || '本步没有额外提示。', 'tip');
      const re = h('button', 'btn small', '重新检查');
      re.onclick = () => this.renderDiag();
      const tk = h('button', 'btn small primary', '让助教接手本步');
      tk.title = '先恢复前面被改乱的设置，再按规范操作完成这一步';
      tk.onclick = async () => { tk.disabled = true; try { await this.takeOver(); } catch (err) { this.say(err.message, 'err'); } finally { this.renderDiag(); } };
      acts.append(hint, re, tk);
      box.append(acts);
    }
  }
  renderChatNote() {
    if (!this.chatEl) return;
    this.chatEl.querySelectorAll('.tt-note').forEach((n) => n.remove());
    import('./ai/providers.js').then(({ loadCfg, cfgReady, PRESETS }) => {
      if (!this.chatEl) return;
      const c = loadCfg();
      const n = h('div', 'tt-note');
      if (cfgReady(c)) n.innerHTML = `已接入：${esc(PRESETS.find((p) => p.id === c.preset)?.name || '自定义')} · <span class="mono">${esc(c.model)}</span>。助教能看到实验状态，必要时会替你转动旋钮，并说明为什么。`;
      else { n.innerHTML = '上面的检查不需要联网。想直接提问，可以在<a href="#" data-c>设置</a>里接入一个大模型：Claude、OpenAI 兼容服务（DeepSeek、通义、Kimi、智谱等）、Gemini，或本机 Ollama。'; n.querySelector('[data-c]').onclick = (e) => { e.preventDefault(); this.settings(); }; }
      this.chatEl.prepend(n);
    });
  }
  bubble(role, html) {
    const b = h('div', 'tt-msg ' + role, html);
    return b;
  }
  say(text, role = 'tip') {
    const html = role === 'act' ? `<span class="tt-act">↻</span>${esc(text)}` : esc(text);
    this.chatLog.push({ role, html });
    if (this.chatLog.length > 60) this.chatLog.shift();
    if (this.chatEl) { this.chatEl.append(this.bubble(role, html)); this.chatEl.scrollTop = this.chatEl.scrollHeight; }
  }

  settings() {
    import('./ai/providers.js').then(({ PRESETS, FORMATS, loadCfg, saveCfg }) => {
      const c = loadCfg();
      const m = this.app.modal('接入大模型', `<div class="tt-cfg">
        <label><span>服务</span><select data-k="preset">${PRESETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}</select></label>
        <label><span>接口格式</span><select data-k="format">${FORMATS.map((f) => `<option value="${f.id}">${f.name}</option>`).join('')}</select></label>
        <label><span>接口地址</span><input data-k="base" spellcheck="false" placeholder="https://…"/></label>
        <label><span>模型名</span><input data-k="model" spellcheck="false" placeholder="服务商提供的模型名"/></label>
        <label><span>密钥</span><input data-k="key" type="password" spellcheck="false" autocomplete="off"/></label>
        <p class="tt-fine">密钥只保存在这台电脑的浏览器里，请求由浏览器直接发给你填的接口地址，不经过任何第三方。服务商不允许网页直接访问时，可以填自己的转发地址。本机 Ollama 需要先设置环境变量 OLLAMA_ORIGINS=* 再启动。</p>
        <div class="tt-test"></div></div>`, [
        { label: '测试连接', onClick: async () => { const t = m.body.querySelector('.tt-test'); t.textContent = '正在连接…'; try { const r = await this.ping(read()); t.textContent = '连接成功：' + r.slice(0, 80); } catch (err) { t.textContent = '连接失败：' + err.message; } } },
        { label: '保存', cls: 'primary', onClick: (close) => { saveCfg(read()); this.conv = null; close(); this.renderChatNote(); } },
      ]);
      const q = (k) => m.body.querySelector(`[data-k=${k}]`);
      const fill = (o) => { for (const k of ['preset', 'format', 'base', 'model', 'key']) if (o[k] != null) q(k).value = o[k]; const p = PRESETS.find((x) => x.id === q('preset').value); q('key').placeholder = p ? p.keyHint : ''; };
      const read = () => ({ preset: q('preset').value, format: q('format').value, base: q('base').value.trim(), model: q('model').value.trim(), key: q('key').value.trim() });
      fill(c);
      q('preset').onchange = () => { const p = PRESETS.find((x) => x.id === q('preset').value); fill({ format: p.format, base: p.base, model: p.model, key: p.noKey ? '' : q('key').value }); };
    });
  }
  async ping(cfg) {
    const { makeConversation } = await import('./ai/providers.js');
    const cv = makeConversation(cfg, '你是连接测试。只回答“好”。', []);
    cv.addUser('测试');
    const r = await cv.step(null);
    return r.text || '（模型有回应）';
  }

  // ======================= 大模型对话 =======================
  systemPrompt() {
    const a = this.app;
    const principle = strip(a.exp.principle ? a.exp.principle() : '').slice(0, 3500);
    return `你是大学物理实验课的助教，正在一台虚拟仿真实验平台上陪学生做「${a.meta.title}」。

你的目标：学生卡在某一步时，找出真正的原因，讲清其中的物理道理，只把有问题的那一项调好（学生能看到旋钮被转动），让他能自己继续做下去。不要替学生把整个实验做完。

工作方法：
- 每次提问都附有当前状态和学生最近的操作轨迹（studentHistory）。先对照这两样找原因：现象是哪个参数造成的？是学生哪一次操作把它弄乱的？需要更早的轨迹时调用 get_history。不要凭空猜参数值。
- 回答要针对这个学生此刻的情况：点名具体的仪器、参数和数值（例如“你在第 2 步把物距调到了 18.0 cm，小于焦距，所以成虚像，屏上找不到像”），不要说放之四海皆准的套话。
- 优先解释和引导：告诉学生现象说明了什么、应该调哪个旋钮、往哪个方向调。学生问“怎么办”或明显卡住时，再用 set_control / press_button / place_component / apply_fix 直接调。一次只改确实有问题的一两项，改完再 get_state 确认效果。
- diagnosis 里带 fix 的条目是程序检查出来的确定问题，可以直接 apply_fix。
- take_over_step 会把整步做完，只在学生明确要求或你多次尝试仍不行时使用。
- 不要编造仪器读数，不要替学生往数据表里填数；读数要学生自己读。
- 回答用简体中文，简短（一般不超过 150 字），数值带单位，公式用 LaTeX（$...$）。

本实验原理摘要：
${principle}`;
  }
  async ask(q) {
    const { loadCfg, cfgReady, makeConversation } = await import('./ai/providers.js');
    const cfg = loadCfg();
    this.say(q, 'user');
    if (!cfgReady(cfg)) { this.say('还没有接入大模型。点右上角“设置”选一个服务并填入密钥（本机 Ollama 不需要密钥）。上面的检查和“帮我调”按钮不联网也能用。', 'tip'); return; }
    if (this.busy) { this.say('上一个问题还没答完，请稍等。', 'tip'); return; }
    this.busy = true;
    const key = JSON.stringify([cfg.format, cfg.base, cfg.model, cfg.key, this.app.meta.id]);
    if (!this.conv || this._convKey !== key) { this.conv = makeConversation(cfg, this.systemPrompt(), TOOLS); this._convKey = key; }
    const cv = this.conv;
    cv.addUser(`${q}\n\n（当前实验状态，供参考）\n${JSON.stringify(this.snapshot())}`);
    this.abort = new AbortController();
    try {
      for (let round = 0; round < 10; round++) {
        let live = null, txt = '';
        const r = await cv.step((t) => {
          txt += t;
          if (!live) { live = this.bubble('ai', ''); this.chatEl && this.chatEl.append(live); }
          live.innerHTML = renderMath(esc(txt)).replace(/\n/g, '<br>');
          if (this.chatEl) this.chatEl.scrollTop = this.chatEl.scrollHeight;
        }, this.abort.signal);
        if (r.text) { const html = renderMath(esc(r.text)).replace(/\n/g, '<br>'); this.chatLog.push({ role: 'ai', html }); if (live) live.innerHTML = html; else this.chatEl && this.chatEl.append(this.bubble('ai', html)); }
        if (!r.calls.length) break;
        const results = [];
        for (const c of r.calls) {
          let result, isError = false;
          if (!c.args) { result = '参数不是有效的 JSON，请重新调用'; isError = true; }
          else { try { result = JSON.stringify(await this.runTool(c.name, c.args)); } catch (err) { result = '失败：' + err.message; isError = true; } }
          results.push({ id: c.id, name: c.name, result, isError });
        }
        cv.addToolResults(results);
        this.renderDiag();
      }
    } catch (err) {
      console.warn(err);
      this.say(err.name === 'AbortError' ? '已停止。' : `调用大模型失败：${err.message}`, 'err');
      this.conv = null; // 出错后重开对话，避免历史里留下不完整的轮次
    } finally { this.busy = false; this.abort = null; }
  }
}
