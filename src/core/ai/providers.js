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
  { id: 'glm', name: '智谱 GLM（需本机中转）', format: 'openai', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', keyHint: '', note: '智谱的接口只允许它自己的网页跨域访问，浏览器不能直连，要经本机中转。用 npm run dev 打开时中转已经内置；双击打开或网页版时，在项目目录运行 npm run relay（或 npm run relay:install 设为开机自启），助教会自动找到它。' },
  { id: 'silicon', name: '硅基流动', format: 'openai', base: 'https://api.siliconflow.cn/v1', model: '', keyHint: 'sk-…' },
  { id: 'openrouter', name: 'OpenRouter', format: 'openai', base: 'https://openrouter.ai/api/v1', model: '', keyHint: 'sk-or-…' },
  { id: 'ollama', name: '本机 Ollama（免费、离线）', format: 'openai', base: 'http://localhost:11434/v1', model: 'qwen2.5:7b', keyHint: '不需要', noKey: true, note: 'Ollama 默认只接受本机网页的请求。先退出 Ollama，设置环境变量 OLLAMA_ORIGINS=* 后再启动（Windows：系统设置 → 环境变量里新建；macOS：launchctl setenv OLLAMA_ORIGINS "*"）。' },
  { id: 'lmstudio', name: '本机 LM Studio', format: 'openai', base: 'http://localhost:1234/v1', model: '', keyHint: '不需要', noKey: true, note: 'LM Studio 默认不允许网页访问：在 Developer（开发者）页的 Server Settings 里打开 “Enable CORS”。' },
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

// ---------------------------------------------------------------- 网络失败的诊断与自动中转
// 浏览器里 fetch 失败只给一个笼统的 TypeError（跨域被拦、地址不通、证书错误都一样）。
// 实测（2026-11）：Anthropic、OpenAI、DeepSeek、通义、Kimi、硅基流动、OpenRouter、Gemini 都允许网页直接调用；
// 智谱只允许它自己的域名，预检请求不返回 Access-Control-Allow-Origin。
// 自动中转：直连失败（或已知不允许网页访问的服务）时，自动探测中转并改走中转——
//   ① npm run dev / preview 打开时，同一服务器下的 /__ai-relay（同源，没有跨域问题）；
//   ② 本机独立运行的中转 127.0.0.1:8787（npm run relay，或 npm run relay:install 设为开机自启）。
// 某个主机走过一次中转，以后就直接走中转。
const NO_BROWSER = [{ re: /(^|\.)bigmodel\.cn$/, name: '智谱开放平台' }];
export const RELAY = 'http://127.0.0.1:8787';
const RELAY_ID = 'physlab-ai-relay';
const isLoop = (h) => /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(h);
const isRelayUrl = (u) => /^\/(__ai-relay\/)?https?:/.test(u.pathname);
const HOW = '在本机运行中转后助教会自动改走中转：项目目录下 npm run relay（关窗口即停止），或 npm run relay:install（开机自动在后台运行）。';
export function netHint(base) {
  let u; try { u = new URL(base); } catch { return '接口地址格式不对，应以 http:// 或 https:// 开头。'; }
  const page = typeof location !== 'undefined' ? location.protocol : 'file:';
  if (page === 'https:' && u.protocol === 'http:' && !isLoop(u.hostname)) return `本页面是 https 网页，浏览器禁止它访问 http 地址 ${u.host}（混合内容）。请改用 https 地址。`;
  const lna = page === 'file:' || isLoop(location.hostname) ? '' : '网页版第一次访问本机服务时，浏览器会询问“是否允许访问本地网络上的设备”，要选允许；点错了可以在地址栏左侧的网站设置里改回来。';
  if (isLoop(u.hostname)) {
    if (isRelayUrl(u)) return `连不上中转（${u.host}）。${HOW}${lna}`;
    if (u.port === '11434') return `连不上本机 Ollama。确认 Ollama 正在运行；它默认只接受本机网页的请求，要先退出 Ollama，设置环境变量 OLLAMA_ORIGINS=* 后再启动。${lna}`;
    if (u.port === '1234') return `连不上本机 LM Studio。确认已在 Developer 页启动服务器，并在 Server Settings 里打开 “Enable CORS”。${lna}`;
    return `连不上本机服务 ${u.host}：确认服务在运行。服务不允许跨域访问（不返回 Access-Control-Allow-Origin）时，用 npm run dev 打开本页面，助教会自动经内置中转访问它；或者独立运行中转时加 --allow ${u.host}，再把接口地址前面加上 ${RELAY}/。${lna}`;
  }
  const nb = NO_BROWSER.find((x) => x.re.test(u.hostname));
  if (nb) return `${nb.name}只允许它自己的网页跨域访问，浏览器里不能直连，需要经本机中转。${HOW}${lna}`;
  return `浏览器没有收到 ${u.host} 的应答，也没有找到本机中转。常见原因：① 这个服务不允许网页直接访问（跨域预检被拒）；② 密钥或模型名不对——有些服务（例如 OpenAI）出错时的响应不带跨域许可，浏览器看不到真正的错误，只能报网络错误；③ 网络不通，或需要代理。${HOW}中转会把服务返回的真实错误原样显示出来。${lna}`;
}
const netError = (base, err) => Object.assign(new Error(netHint(base)), { name: 'NetError', cause: err });
/** fetch 的包装：网络层失败（不是用户点停止）时换成带诊断的错误 */
async function netFetch(base, url, init) {
  try { return await fetch(url, init); } catch (err) { if (err && err.name === 'AbortError') throw err; throw netError(base, err); }
}

let relayP = null, relayT = 0;
/** 找一个正在运行的中转，返回它的前缀（找不到为 null）。结果缓存：找到了一直用，没找到 10 秒后再试 */
export function findRelay() {
  if (relayP && (Date.now() - relayT < 10000 || relayP.ok)) return relayP;
  relayT = Date.now();
  const cands = [];
  if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) cands.push(location.origin + '/__ai-relay');
  cands.push(RELAY);
  relayP = (async () => {
    for (const c of cands) {
      try {
        const r = await fetch(c + '/', { signal: AbortSignal.timeout(1500), cache: 'no-store' });
        if (r.ok && (await r.json()).relay === RELAY_ID) { relayP.ok = true; return c; }
      } catch { /* 下一个 */ }
    }
    return null;
  })();
  return relayP;
}
const viaRelay = new Set();
/** 发请求：本机地址直连；已知不允许网页访问、或上次直连失败的主机走中转；直连失败时自动找中转重试 */
async function routedFetch(url, init) {
  const u = new URL(url);
  if (isRelayUrl(u)) return netFetch(url, url, init);
  const relayed = async (r) => { viaRelay.add(u.host); return netFetch(r + '/', `${r}/${url}`, init); };
  // 本机服务（Ollama、LM Studio、其他本地模型）：先直连；不允许跨域时，只能借同源的内置中转（npm run dev / preview）
  if (isLoop(u.hostname)) {
    const own = async () => { const r = await findRelay(); return r && typeof location !== 'undefined' && r.startsWith(location.origin + '/') ? r : null; };
    if (viaRelay.has(u.host)) { const r = await own(); if (r) return relayed(r); }
    try { return await fetch(url, init); } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      if (init && init.signal && init.signal.aborted) throw err;
      const r = await own();
      if (r) return relayed(r);
      throw netError(url, err);
    }
  }
  if (viaRelay.has(u.host) || NO_BROWSER.some((x) => x.re.test(u.hostname))) {
    const r = await findRelay();
    if (r) return relayed(r);
    throw netError(url);
  }
  try { return await fetch(url, init); } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    if (init && init.signal && init.signal.aborted) throw err;
    const r = await findRelay();
    if (r) return relayed(r);
    throw netError(url, err);
  }
}
/** 当前某个接口地址实际怎么走（设置框里显示） */
export async function routeOf(base) {
  try { const u = new URL(base); if (isRelayUrl(u)) return { via: 'direct' }; if (viaRelay.has(u.host) || NO_BROWSER.some((x) => x.re.test(u.hostname))) { const r = await findRelay(); return { via: r ? 'relay' : 'none', relay: r }; } } catch { /* 忽略 */ }
  return { via: 'direct' };
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
    const res = await routedFetch(base.replace(/\/+$/, '') + '/chat/completions', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) });
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
    const res = await routedFetch(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
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
    const custom = (this._custom = !!(base && !/^https:\/\/api\.anthropic\.com\/?$/.test(base)));
    // SDK 在浏览器里还会带 X-Stainless-* 等 8 个统计用请求头。官方接口的预检放行它们，但很多第三方转发服务的
    // 预检白名单里没有，整个请求就被浏览器拦下。这里在发出前去掉；转发服务也用不上“允许浏览器直连”的声明头。
    const slim = (url, init = {}) => {
      const h = new Headers(init.headers);
      for (const k of [...h.keys()]) if (k.startsWith('x-stainless-') || (custom && k === 'anthropic-dangerous-direct-browser-access')) h.delete(k);
      return routedFetch(String(url), { ...init, headers: h });
    };
    this._c = new Anthropic({ apiKey: key, ...(custom ? { baseURL: base.replace(/\/+$/, '') } : {}), dangerouslyAllowBrowser: true, fetch: slim, maxRetries: 1 });
    return this._c;
  }
  async step(onText, signal) {
    const c = await this.client(), model = this.cfg.model;
    const params = { model, max_tokens: 16000, system: this.system, messages: this.msgs, tools: this.tools, ...(EFFORT_MODELS.test(model) ? { output_config: { effort: 'low' } } : {}) };
    const fb = FALLBACK_MODELS.test(model) && !this._custom;
    const stream = fb ? c.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal }) : c.messages.stream(params, { signal });
    stream.on('text', (t) => onText && onText(t));
    let msg;
    try { msg = await stream.finalMessage(); } catch (err) {
      // SDK 把网络失败包成 APIConnectionError，原因在 cause 里
      const ne = err && (err.name === 'NetError' ? err : err.cause && err.cause.name === 'NetError' ? err.cause : null);
      if (ne) throw ne;
      if (err && err.name === 'APIConnectionError' && !(signal && signal.aborted)) throw netError(this.cfg.base || 'https://api.anthropic.com', err);
      throw err;
    }
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
/** 本机服务（不经中转）可以不填密钥 */
const localNoKey = (base) => { try { const u = new URL(base); return isLoop(u.hostname) && !/^\/https?:/.test(u.pathname); } catch { return false; } };
export const cfgReady = (c) => !!(c && c.format && c.base && c.model && (c.key || PRESETS.find((p) => p.id === c.preset)?.noKey || localNoKey(c.base)));
