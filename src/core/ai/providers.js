// 大模型接入：三种接口格式的适配器（按需加载，不影响离线使用）
//   anthropic —— Claude（Anthropic Messages API，官方 SDK）
//   openai    —— OpenAI Chat Completions 兼容格式：OpenAI、DeepSeek、通义千问、Kimi、智谱、硅基流动、OpenRouter、
//                本机 Ollama / LM Studio / vLLM 等绝大多数服务都提供这种格式
//   gemini    —— Google Gemini generateContent
// 每个适配器维护自己原生格式的对话历史（不做有损转换：Claude 的思考块、Gemini 的 thoughtSignature 原样回传），
// 对外只暴露统一的三件事：addUser(text) · step(onText) → { text, calls:[{id,name,args}] } · addToolResults(results)

export const FORMATS = [
  { id: 'anthropic', name: 'Anthropic Messages（Claude）' },
  { id: 'openai', name: 'OpenAI Chat Completions 兼容' },
  { id: 'gemini', name: 'Google Gemini' },
];

// 常用服务的预设：只是帮忙填好地址和示例模型名，模型名都可以改成服务商当前提供的任何型号
export const PRESETS = [
  { id: 'claude', name: 'Claude（Anthropic）', format: 'anthropic', base: 'https://api.anthropic.com', model: 'claude-opus-5-5', keyHint: 'sk-ant-…' },
  { id: 'openai', name: 'OpenAI', format: 'openai', base: 'https://api.openai.com/v1', model: '', keyHint: 'sk-…' },
  { id: 'deepseek', name: 'DeepSeek 深度求索', format: 'openai', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keyHint: 'sk-…' },
  { id: 'qwen', name: '通义千问（阿里云百炼）', format: 'openai', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', keyHint: 'sk-…' },
  { id: 'kimi', name: 'Kimi（月之暗面）', format: 'openai', base: 'https://api.moonshot.cn/v1', model: '', keyHint: 'sk-…' },
  { id: 'glm', name: '智谱 GLM', format: 'openai', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', keyHint: '' },
  { id: 'silicon', name: '硅基流动', format: 'openai', base: 'https://api.siliconflow.cn/v1', model: '', keyHint: 'sk-…' },
  { id: 'openrouter', name: 'OpenRouter', format: 'openai', base: 'https://openrouter.ai/api/v1', model: '', keyHint: 'sk-or-…' },
  { id: 'ollama', name: '本机 Ollama（免费、离线）', format: 'openai', base: 'http://localhost:11434/v1', model: 'qwen2.5:7b', keyHint: '不需要', noKey: true },
  { id: 'lmstudio', name: '本机 LM Studio', format: 'openai', base: 'http://localhost:1234/v1', model: '', keyHint: '不需要', noKey: true },
  { id: 'gemini', name: 'Google Gemini', format: 'gemini', base: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-flash', keyHint: 'AIza…' },
  { id: 'custom', name: '自定义', format: 'openai', base: '', model: '', keyHint: '' },
];

/** 工具描述（统一格式）→ 各家格式。参数一律用字符串，兼容对 JSON Schema 支持较弱的服务 */
const schemaOf = (t) => ({ type: 'object', properties: Object.fromEntries(Object.entries(t.params || {}).map(([k, d]) => [k, { type: 'string', description: d }])), required: Object.keys(t.params || {}) });

/** 逐行读取 SSE（data: …） */
async function* sse(res) {
  const rd = res.body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await rd.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
      if (line.startsWith('data:')) { const d = line.slice(5).trim(); if (d && d !== '[DONE]') yield d; }
    }
  }
  const tail = buf.trim();
  if (tail.startsWith('data:')) { const d = tail.slice(5).trim(); if (d && d !== '[DONE]') yield d; }
}

async function httpError(res) {
  let msg = '';
  try { const t = await res.text(); try { const j = JSON.parse(t); msg = (j.error && (j.error.message || j.error)) || j.message || t; } catch { msg = t; } } catch { /* 忽略 */ }
  const hint = res.status === 401 || res.status === 403 ? '（密钥无效或没有权限）' : res.status === 404 ? '（地址或模型名不对）' : res.status === 429 ? '（请求太频繁或额度用完）' : '';
  return new Error(`HTTP ${res.status}${hint}：${String(msg).slice(0, 300)}`);
}

const parseArgs = (s) => { if (s && typeof s === 'object') return s; try { const o = JSON.parse(s || '{}'); return o && typeof o === 'object' ? o : null; } catch { return null; } };

// ---------------------------------------------------------------- OpenAI Chat Completions 兼容
class OpenAIChat {
  constructor(cfg, system, tools) {
    this.cfg = cfg; this.tools = tools;
    this.msgs = [{ role: 'system', content: system }];
  }
  addUser(text) { this.msgs.push({ role: 'user', content: text }); }
  addToolResults(rs) { for (const r of rs) this.msgs.push({ role: 'tool', tool_call_id: r.id, content: r.result }); }
  async step(onText, signal) {
    const { base, key, model } = this.cfg;
    const body = { model, messages: this.msgs, stream: true, tools: this.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: schemaOf(t) } })) };
    const res = await fetch(base.replace(/\/+$/, '') + '/chat/completions', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) });
    if (!res.ok) throw await httpError(res);
    let text = ''; const tc = [];
    const take = (m) => {
      if (!m) return;
      if (m.content) { text += m.content; onText && onText(m.content); }
      for (const d of m.tool_calls || []) {
        const k = d.index ?? tc.length, c = tc[k] || (tc[k] = { id: '', name: '', args: '' });
        if (d.id) c.id = d.id;
        if (d.function) { if (d.function.name) c.name += d.function.name; if (d.function.arguments) c.args += typeof d.function.arguments === 'string' ? d.function.arguments : JSON.stringify(d.function.arguments); }
      }
    };
    if ((res.headers.get('content-type') || '').includes('application/json')) { const j = await res.json(); take(j.choices && j.choices[0] && j.choices[0].message); }
    else for await (const d of sse(res)) { let j; try { j = JSON.parse(d); } catch { continue; } if (j.error) throw new Error(j.error.message || JSON.stringify(j.error)); take(j.choices && j.choices[0] && j.choices[0].delta); }
    const calls = tc.filter(Boolean).map((c, i) => ({ id: c.id || `call_${Date.now()}_${i}`, name: c.name, args: parseArgs(c.args), raw: c.args }));
    this.msgs.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.raw || '{}' } })) } : {}) });
    return { text, calls };
  }
}

// ---------------------------------------------------------------- Google Gemini
class Gemini {
  constructor(cfg, system, tools) {
    this.cfg = cfg; this.system = system; this.tools = tools; this.contents = [];
  }
  addUser(text) { this.contents.push({ role: 'user', parts: [{ text }] }); }
  addToolResults(rs) { this.contents.push({ role: 'user', parts: rs.map((r) => ({ functionResponse: { name: r.name, response: { result: r.result } } })) }); }
  async step(onText, signal) {
    const { base, key, model } = this.cfg;
    const url = `${base.replace(/\/+$/, '')}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    const body = { systemInstruction: { parts: [{ text: this.system }] }, contents: this.contents, tools: [{ functionDeclarations: this.tools.map((t) => ({ name: t.name, description: t.description, ...(t.params && Object.keys(t.params).length ? { parameters: schemaOf(t) } : {}) })) }] };
    const res = await fetch(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
    if (!res.ok) throw await httpError(res);
    let text = ''; const parts = [], calls = [];
    for await (const d of sse(res)) {
      let j; try { j = JSON.parse(d); } catch { continue; }
      if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
      const ps = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
      for (const p of ps) {
        // 原样保留每个 part（含 thoughtSignature），回传时 Gemini 才能接上自己的推理
        if (p.text != null && !p.thought) { text += p.text; onText && onText(p.text); const last = parts[parts.length - 1]; if (last && last.text != null && !last.functionCall && !last.thoughtSignature && !p.thoughtSignature) last.text += p.text; else parts.push({ ...p }); }
        else { parts.push(p); if (p.functionCall) calls.push({ id: `g${Date.now()}_${calls.length}`, name: p.functionCall.name, args: p.functionCall.args || {} }); }
      }
    }
    this.contents.push({ role: 'model', parts: parts.length ? parts : [{ text: '' }] });
    return { text, calls };
  }
}

// ---------------------------------------------------------------- Anthropic Messages（Claude）
// 用官方 SDK；Claude Opus 5.5 等新型号默认打开服务端回退（某次请求被安全分类器拒绝时自动换用备用型号接着答）
const FALLBACK_MODELS = /^claude-(opus-5(-5)?|fable-5-[12]|sonnet-5-5)$/;
const EFFORT_MODELS = /^claude-(opus|fable|mythos|sonnet-5|haiku-5)/;
class Claude {
  constructor(cfg, system, tools) {
    this.cfg = cfg; this.system = system; this.msgs = [];
    this.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: schemaOf(t), eager_input_streaming: true }));
  }
  addUser(text) { this.msgs.push({ role: 'user', content: text }); }
  addToolResults(rs) { this.msgs.push({ role: 'user', content: rs.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.result, ...(r.isError ? { is_error: true } : {}) })) }); }
  async client() {
    if (this._c) return this._c;
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const { key, base } = this.cfg;
    this._c = new Anthropic({ apiKey: key, ...(base && !/^https:\/\/api\.anthropic\.com\/?$/.test(base) ? { baseURL: base.replace(/\/+$/, '') } : {}), dangerouslyAllowBrowser: true });
    this._custom = !!(base && !/^https:\/\/api\.anthropic\.com\/?$/.test(base));
    return this._c;
  }
  async step(onText, signal) {
    const c = await this.client(), model = this.cfg.model;
    const params = { model, max_tokens: 16000, system: this.system, messages: this.msgs, tools: this.tools, ...(EFFORT_MODELS.test(model) ? { output_config: { effort: 'low' } } : {}) };
    const fb = FALLBACK_MODELS.test(model) && !this._custom;
    const stream = fb ? c.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal }) : c.messages.stream(params, { signal });
    stream.on('text', (t) => onText && onText(t));
    const msg = await stream.finalMessage();
    // 完整回传 content（含思考块），保证多轮对话里模型的推理连贯
    this.msgs.push({ role: 'assistant', content: msg.content });
    if (msg.stop_reason === 'refusal') return { text: '（这个问题模型拒绝回答，换个问法试试。）', calls: [] };
    if (msg.stop_reason === 'max_tokens') return { text: msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('') + '…（回答被截断）', calls: [] };
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const calls = msg.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input && typeof b.input === 'object' && !Array.isArray(b.input) ? b.input : null }));
    return { text, calls };
  }
}

export function makeConversation(cfg, system, tools) {
  if (cfg.format === 'anthropic') return new Claude(cfg, system, tools);
  if (cfg.format === 'gemini') return new Gemini(cfg, system, tools);
  return new OpenAIChat(cfg, system, tools);
}

// ---------------------------------------------------------------- 设置（只存在本机浏览器里）
const LS = 'tutorAI';
export function loadCfg() {
  try { const c = JSON.parse(localStorage.getItem(LS) || 'null'); if (c && c.format) return c; } catch { /* 忽略 */ }
  return { preset: 'claude', format: 'anthropic', base: PRESETS[0].base, model: PRESETS[0].model, key: '' };
}
export function saveCfg(c) { try { localStorage.setItem(LS, JSON.stringify(c)); } catch { /* 无痕模式 */ } }
export const cfgReady = (c) => !!(c && c.format && c.base && c.model && (c.key || PRESETS.find((p) => p.id === c.preset)?.noKey || /localhost|127\.0\.0\.1/.test(c.base)));
