// 实验数据记录表：支持仪器自动读数记录、手动输入修改、计算列
import { dms, parseDms } from './Stats.js';

export class DataTable {
  /**
   * spec: { id, title, note, columns:[{key,label,digits,type:'num'|'text'|'dms',calc?(row,i,rows),readonly?}],
   *         buttons:[{label, onClick(table), primary?}], initRows?():[], maxRows? }
   */
  constructor(spec, app) {
    this.spec = spec;
    this.app = app;
    this.id = spec.id;
    this.rows = spec.initRows ? spec.initRows() : [];
    this.fresh = -1;
    this.el = null;
  }

  addRow(obj = {}) {
    if (this.spec.maxRows && this.rows.length >= this.spec.maxRows) {
      this.app.toast(`「${this.spec.title}」最多记录 ${this.spec.maxRows} 组`, 'warn');
      return -1;
    }
    this.rows.push({ ...obj });
    const i = (this.fresh = this.rows.length - 1);
    if (this.selfRead) for (const k of Object.keys(obj)) this.pend(this.rows[i], k);
    this.changed();
    return i;
  }
  set(i, key, val) {
    if (!this.rows[i]) return;
    this.rows[i][key] = val;
    if (this.selfRead) this.pend(this.rows[i], key);
    else if (this.rows[i]._pend) { delete this.rows[i]._pend[key]; if (this.rows[i]._chk) delete this.rows[i]._chk[key]; }
    this.fresh = i;
    this.changed();
  }
  // ---------- 学生自己读数：记录时只记下仪器示数作参照，表格里留空让学生填 ----------
  readable(key) {
    const c = this.spec.columns.find((c) => c.key === key);
    return c && !c.calc && !c.readonly && c.type !== 'text' && !c.auto ? c : null;
  }
  pend(row, key) {
    const c = this.readable(key), v = row[key];
    if (!c || typeof v !== 'number' || !isFinite(v)) return;
    (row._ref || (row._ref = {}))[key] = v;
    (row._pend || (row._pend = {}))[key] = true;
    if (row._chk) delete row._chk[key];
    this.pended = (this.pended || 0) + 1;
  }
  isPend(row, key) { return !!(row._pend && row._pend[key]); }
  hasPend(row) { return !!(row._pend && Object.keys(row._pend).length); }
  /** 学生读数与仪器示数的允许偏差 */
  readTol(c, ref) {
    if (c.readTol != null) return typeof c.readTol === 'function' ? c.readTol(ref) : c.readTol;
    if (c.type === 'dms') return 2 / 60;
    const d = c.digits ?? 3;
    return 3 * 10 ** -d + 0.001 * Math.abs(ref);
  }

  /** 找到 key 列第一个空单元所在行 */
  firstEmpty(key) {
    return this.rows.findIndex((r) => r[key] == null || r[key] === '' || Number.isNaN(r[key]));
  }
  removeRow(i) { this.rows.splice(i, 1); this.changed(); }
  clear() { this.rows = this.spec.initRows ? this.spec.initRows() : []; this.changed(); }

  /** 返回某列所有有效数值（计算列也可） */
  col(key) {
    return this.rows.map((r, i) => this.value(r, key, i)).filter((v) => typeof v === 'number' && isFinite(v));
  }
  value(row, key, i) {
    const c = this.spec.columns.find((c) => c.key === key);
    if (c && c.calc) { if (this.hasPend(row)) return NaN; try { return c.calc(row, i, this.rows); } catch { return NaN; } }
    return this.isPend(row, key) ? null : row[key];
  }
  /** 完整行（所有输入列都已填写） */
  completeRows() {
    const keys = this.spec.columns.filter((c) => !c.calc && !c.optional).map((c) => c.key);
    return this.rows.filter((r) => keys.every((k) => r[k] != null && r[k] !== '' && !this.isPend(r, k) && !(typeof r[k] === 'number' && !isFinite(r[k]))));
  }

  changed() {
    this.render();
    this.app && this.app.onTableChanged(this);
  }

  fmt(c, v) {
    if (v == null || v === '' || (typeof v === 'number' && !isFinite(v))) return '';
    if (c.type === 'dms') return dms(v);
    if (c.type === 'text' || typeof v !== 'number') return String(v);
    return c.digits != null ? v.toFixed(c.digits) : String(+v.toPrecision(8));
  }

  mount(el) { this.el = el; this.render(); }

  render() {
    if (!this.el) return;
    const cols = this.spec.columns;
    const head = `<tr><th>#</th>${cols.map((c) => `<th>${c.label}</th>`).join('')}<th></th></tr>`;
    const body = this.rows.map((r, i) => {
      const tds = cols.map((c) => {
        const v = this.value(r, c.key, i);
        if (c.calc) return `<td class="calc">${this.fmt(c, v)}</td>`;
        if (c.readonly) return `<td class="lbl">${this.fmt(c, v)}</td>`;
        const pend = this.isPend(r, c.key), chk = r._chk && r._chk[c.key];
        return `<td class="${pend ? 'toread' : chk ? 'rd-' + chk : ''}"><input data-r="${i}" data-k="${c.key}" value="${this.fmt(c, v)}" placeholder="${pend ? '读数' : '—'}"${chk === 'bad' ? ' title="与仪器示数不符，请重新读数"' : ''}/></td>`;
      }).join('');
      return `<tr class="${i === this.fresh ? 'fresh' : ''}"><td class="idx">${i + 1}</td>${tds}<td>${this.spec.fixedRows ? '' : `<button class="x" data-del="${i}" title="删除此行">✕</button>`}</td></tr>`;
    }).join('');
    this.el.innerHTML = `<table class="dt"><thead>${head}</thead><tbody>${body || `<tr><td class="empty" colspan="${cols.length + 2}">还没有数据。调好仪器后点击右侧的记录按钮，也可以直接在表格里填写。</td></tr>`}</tbody></table>`;
    this.fresh = -1;
    this.el.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('change', () => {
        const i = +inp.dataset.r, k = inp.dataset.k;
        const c = cols.find((c) => c.key === k);
        let v = inp.value.trim();
        if (v === '') v = null;
        else if (c.type === 'dms') v = parseDms(v);
        else if (c.type !== 'text') v = parseFloat(v);
        const row = this.rows[i];
        row[k] = v;
        if (row._pend) delete row._pend[k];
        const ref = row._ref && row._ref[k];
        if (ref != null && typeof v === 'number' && isFinite(v)) {
          const ok = Math.abs(v - ref) <= this.readTol(c, ref);
          (row._chk || (row._chk = {}))[k] = ok ? 'ok' : 'bad';
          if (!ok) this.app && this.app.toast(`第 ${i + 1} 行「${c.label.replace(/<[^>]+>/g, '')}」与仪器示数不符，请再仔细读一次`, 'warn');
        } else if (row._chk) delete row._chk[k];
        this.changed();
      });
    });
    this.el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => this.removeRow(+b.dataset.del)));
  }

  /** 制表符分隔文本（可直接粘贴到 Excel / WPS 表格） */
  toTSV() {
    const cols = this.spec.columns;
    const lines = [this.spec.title, ['序号', ...cols.map((c) => c.label)].join('\t')];
    this.rows.forEach((r, i) => lines.push([i + 1, ...cols.map((c) => this.fmt(c, this.value(r, c.key, i)))].join('\t')));
    return lines.join('\n');
  }

  /** 报告用静态 HTML */
  toHTML() {
    const cols = this.spec.columns;
    const head = `<tr><th>序号</th>${cols.map((c) => `<th>${c.label}</th>`).join('')}</tr>`;
    const body = this.rows.map((r, i) => `<tr><td>${i + 1}</td>${cols.map((c) => `<td>${this.fmt(c, this.value(r, c.key, i))}</td>`).join('')}</tr>`).join('');
    return `<h3>${this.spec.title}</h3><table>${head}${body}</table>`;
  }
}
