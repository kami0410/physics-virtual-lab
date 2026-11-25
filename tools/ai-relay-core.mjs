// AI 助教中转的核心：给不允许网页直接访问的大模型接口补上跨域许可。
// 两处使用：tools/ai-relay.mjs（独立运行，监听 127.0.0.1:8787）和 vite.config.js（npm run dev / preview 时
// 挂在同一服务器的 /__ai-relay/ 下，页面同源访问，根本不需要跨域）。
//
// 请求格式：<中转前缀>/<完整的接口地址>，如 http://127.0.0.1:8787/https://open.bigmodel.cn/api/paas/v4/chat/completions
// GET <中转前缀>/ 返回 {"relay":"physlab-ai-relay"}，助教据此判断中转是否在运行。
// 安全：默认只转发到下面列出的大模型服务（https）；allow 可以再加主机（加 127.0.0.1:端口 这样的本机地址时允许 http）；
// any 放开到任意 https 主机。密钥由浏览器随请求带来，中转不保存、不记录请求内容。
import http from 'node:http';

export const RELAY_ID = 'physlab-ai-relay';
export const DEFAULT_HOSTS = [
  'api.anthropic.com', 'api.openai.com', 'api.deepseek.com', 'dashscope.aliyuncs.com', 'api.moonshot.cn',
  'open.bigmodel.cn', 'api.siliconflow.cn', 'openrouter.ai', 'generativelanguage.googleapis.com',
  'ark.cn-beijing.volces.com', 'qianfan.baidubce.com', 'api.hunyuan.cloud.tencent.com', 'api.minimaxi.com', 'api.lingyiwanwu.com', 'api.stepfun.com',
];
const loop = (h) => /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(h);
// 不转发给上游的请求头：浏览器身份相关的、逐跳的、会让上游再做一次跨域判断的
const DROP_REQ = /^(host|origin|referer|cookie|connection|keep-alive|content-length|accept-encoding|transfer-encoding|upgrade|te|trailer|proxy-.*|sec-.*|access-control-request-.*)$/i;
const DROP_RES = /^(content-encoding|content-length|transfer-encoding|connection|keep-alive|set-cookie|access-control-.*|strict-transport-security|alt-svc)$/i;

const WHY = [
  [/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/, '证书校验失败，网络中的代理或安全软件拦截了 HTTPS'],
  [/ENOTFOUND|EAI_AGAIN/, '域名解析失败，检查网络'],
  [/ECONNREFUSED/, '连接被拒绝'],
  [/ECONNRESET|UND_ERR_SOCKET|other side closed/, '连接被中断'],
  [/ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|timeout/i, '连接超时，检查网络或代理'],
];
const explain = (code) => { const w = WHY.find(([re]) => re.test(String(code))); return w ? `${w[1]}（${code}）` : String(code); };

let proxied = null;
/** 系统设置了 HTTPS_PROXY 时让 Node 的 fetch 走代理（Node 24 起支持）；返回代理地址或空 */
export function useEnvProxy() {
  if (proxied !== null) return proxied;
  const p = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
  proxied = '';
  if (p && typeof http.setGlobalProxyFromEnv === 'function') { try { http.setGlobalProxyFromEnv(); proxied = p; } catch { /* 旧版本 Node：直连 */ } }
  return proxied;
}

/**
 * @param {{allow?: string[], any?: boolean, log?: (line: string) => void}} o
 * @returns {(req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>} req.url 为去掉前缀后的部分
 */
export function relayHandler(o = {}) {
  useEnvProxy();
  const ALLOW = new Set([...DEFAULT_HOSTS, ...(o.allow || []).map((s) => s.trim().toLowerCase()).filter(Boolean)]);
  const log = o.log || (() => {});
  const allowed = (u) => {
    if (ALLOW.has(u.host.toLowerCase()) || ALLOW.has(u.hostname.toLowerCase())) return u.protocol === 'https:' || loop(u.hostname);
    return !!o.any && u.protocol === 'https:' && !loop(u.hostname);
  };
  const cors = (req) => ({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Expose-Headers': '*',
    'Access-Control-Max-Age': '86400',
  });
  const json = (req, res, code, obj) => { res.writeHead(code, { ...cors(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

  return async (req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors(req)); return res.end(); }
    const path = (req.url || '/').replace(/^\/+/, '');
    if (!path || path === '__relay') return json(req, res, 200, { relay: RELAY_ID, v: 1 });
    let target;
    try { target = new URL(path); } catch { return json(req, res, 400, { error: { message: '中转地址格式：<中转地址>/https://服务商的接口地址' } }); }
    if (!allowed(target)) return json(req, res, 403, { error: { message: `中转没有放行 ${target.host}。独立运行中转时加 --allow ${target.host}` } });
    const t0 = Date.now(), ac = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    try {
      const chunks = []; for await (const c of req) chunks.push(c);
      const headers = {}; for (const [k, v] of Object.entries(req.headers)) if (!DROP_REQ.test(k)) headers[k] = v;
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks);
      const go = () => fetch(target, { method: req.method, headers, body, signal: ac.signal, redirect: 'follow' });
      // 网络层的偶发失败（连接被重置、代理线路返回错误证书等）重试一次：请求体已经缓存，还没有收到任何应答，可以安全重发
      let up; try { up = await go(); } catch (e) { if (ac.signal.aborted) throw e; await new Promise((r) => setTimeout(r, 400)); up = await go(); }
      const out = { ...cors(req) }; up.headers.forEach((v, k) => { if (!DROP_RES.test(k)) out[k] = v; });
      res.writeHead(up.status, out);
      if (up.body) for await (const c of up.body) res.write(c);
      res.end();
      log(`${new Date().toLocaleTimeString()}  ${req.method} ${target.host}  ${up.status}  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    } catch (err) {
      if (ac.signal.aborted) return;
      const why = explain(err.cause?.code || err.cause?.message || err.message);
      log(`${new Date().toLocaleTimeString()}  ${req.method} ${target.host}  失败：${why}`);
      if (!res.headersSent) json(req, res, 502, { error: { message: `中转连不上 ${target.host}：${why}` } }); else res.end();
    }
  };
}

/** Vite 插件：npm run dev / npm run preview 时在同一服务器的 /__ai-relay/ 下提供中转 */
export function viteAiRelay() {
  const mount = (srv) => {
    const h = relayHandler({ log: (l) => srv.config.logger.info(`[AI 中转] ${l}`, { timestamp: false }) });
    srv.middlewares.use('/__ai-relay', (req, res) => { h(req, res); });
  };
  return { name: 'physlab-ai-relay', configureServer: mount, configurePreviewServer: mount };
}
