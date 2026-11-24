// 仪器调节控件：滑块、旋钮(手轮)、开关、选择、按钮、读数
// 描述符形式 { type, label, get, set, ... }，控件自动从 get() 刷新显示

const h = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

function fmtVal(d, v) {
  if (d.fmt) return d.fmt(v);
  if (typeof v !== 'number') return String(v);
  const dig = d.digits ?? 2;
  return v.toFixed(dig) + (d.unit ? ' ' + d.unit : '');
}

export function buildControl(d, onChange) {
  const set = (v) => { d.set(v); onChange && onChange(); };
  let el, refresh = () => {};

  if (d.type === 'slider') {
    el = h('div', 'ctl');
    const lab = h('label', null, `<span>${d.label}</span><span class="val"></span>`);
    const input = h('input'); input.type = 'range';
    input.min = d.min; input.max = d.max; input.step = d.step ?? (d.max - d.min) / 1000;
    input.addEventListener('input', () => set(parseFloat(input.value)));
    el.append(lab, input);
    if (d.sub) el.append(h('div', 'sub', d.sub));
    const val = lab.querySelector('.val');
    refresh = () => {
      const v = d.get();
      if (document.activeElement !== input) input.value = v;
      val.textContent = fmtVal(d, v);
    };
  } else if (d.type === 'knob') {
    // 旋钮：拖动转盘连续调节；◀ ▶ 单步；◀◀ ▶▶ 十步；滚轮调节
    el = h('div', 'ctl');
    const lab = h('label', null, `<span>${d.label}</span><span class="val"></span>`);
    const row = h('div', 'knob-row');
    const step = d.step ?? 0.01;
    const big = d.bigStep ?? step * 10;
    const perRev = d.perRev ?? step * 100;
    const mk = (txt, delta, title) => {
      const b = h('button', 'btn small', txt); b.title = title;
      let timer, rep;
      const fire = () => set(clampV(d, d.get() + delta));
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); fire();
        timer = setTimeout(() => { rep = setInterval(fire, 60); }, 380);
      });
      const stop = () => { clearTimeout(timer); clearInterval(rep); };
      b.addEventListener('pointerup', stop); b.addEventListener('pointerleave', stop);
      return b;
    };
    const dial = h('div', 'dial'); const mark = h('div', 'mark'); dial.append(mark);
    let drag = null;
    dial.addEventListener('pointerdown', (e) => {
      dial.setPointerCapture(e.pointerId);
      const r = dial.getBoundingClientRect();
      drag = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, a: Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) };
    });
    dial.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const a = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
      let da = a - drag.a;
      if (da > Math.PI) da -= 2 * Math.PI;
      if (da < -Math.PI) da += 2 * Math.PI;
      drag.a = a;
      const nv = d.get() + (da / (2 * Math.PI)) * perRev;
      set(clampV(d, nv));
    });
    const end = () => { drag = null; };
    dial.addEventListener('pointerup', end); dial.addEventListener('pointercancel', end);
    dial.addEventListener('wheel', (e) => { e.preventDefault(); set(clampV(d, d.get() + (e.deltaY < 0 ? step : -step) * (e.shiftKey ? 10 : 1))); }, { passive: false });
    row.append(mk('◀◀', -big, '反转(大步)'), mk('◀', -step, '反转(单步)'), dial, mk('▶', step, '正转(单步)'), mk('▶▶', big, '正转(大步)'));
    el.append(lab, row);
    if (d.sub) el.append(h('div', 'sub', d.sub));
    const val = lab.querySelector('.val');
    refresh = () => {
      const v = d.get();
      const ang = d.angle ? d.angle(v) : (v / perRev) * 360;
      mark.style.transform = `rotate(${ang}deg)`;
      val.textContent = fmtVal(d, v);
    };
  } else if (d.type === 'toggle') {
    el = h('div', 'ctl toggle');
    const lab = h('span', null, d.label);
    const sw = h('div', 'switch');
    sw.addEventListener('click', () => set(!d.get()));
    el.append(lab, sw);
    refresh = () => sw.classList.toggle('on', !!d.get());
  } else if (d.type === 'select') {
    el = h('div', 'ctl');
    const lab = h('label', null, `<span>${d.label}</span>`);
    const sel = h('select'); sel.style.width = '100%';
    for (const o of d.options) {
      const op = h('option', null, o.label); op.value = o.value; sel.append(op);
    }
    sel.addEventListener('change', () => set(sel.value));
    el.append(lab, sel);
    if (d.sub) el.append(h('div', 'sub', d.sub));
    refresh = () => { if (document.activeElement !== sel) sel.value = d.get(); };
  } else if (d.type === 'segment') {
    el = h('div', 'ctl');
    el.append(h('label', null, `<span>${d.label}</span>`));
    const seg = h('div', 'seg');
    const btns = d.options.map((o) => {
      const b = h('button', 'btn small', o.label);
      b.addEventListener('click', () => set(o.value));
      seg.append(b); return [o.value, b];
    });
    el.append(seg);
    refresh = () => { const v = d.get(); btns.forEach(([ov, b]) => b.classList.toggle('active', ov === v)); };
  } else if (d.type === 'button') {
    el = h('button', 'btn ' + (d.cls || ''), d.label);
    el.style.width = '100%';
    el.addEventListener('click', () => { d.onClick(); onChange && onChange(); });
  } else if (d.type === 'readout') {
    el = h('div', 'ctl');
    el.append(h('label', null, `<span>${d.label}</span>`));
    const r = h('div', 'readout');
    el.append(r);
    if (d.sub) el.append(h('div', 'sub', d.sub));
    refresh = () => { r.textContent = d.get(); };
  } else if (d.type === 'note') {
    el = h('div', 'insp-desc', d.html);
  } else if (d.type === 'group') {
    el = h('div', 'ph', d.label);
  } else {
    el = h('div', null, '?');
  }
  refresh();
  return { el, refresh };
}

function clampV(d, v) {
  if (d.wrap) { const r = d.wrap; return ((v % r) + r) % r; }
  if (d.min != null) v = Math.max(d.min, v);
  if (d.max != null) v = Math.min(d.max, v);
  return v;
}

export { h };
