#!/usr/bin/env node
// AI 助教的本机中转：给不允许网页直接访问（不响应跨域预检）的大模型接口补上跨域许可。
//
// 用法：node tools/ai-relay.mjs [--port 8787] [--allow 主机1,主机2] [--any]
//       （项目目录下也可以 npm run relay）
// 然后在助教设置里把接口地址写成  http://127.0.0.1:8787/<原来的地址>，例如
//       http://127.0.0.1:8787/https://open.bigmodel.cn/api/paas/v4
//
// 安全：只监听本机 127.0.0.1；默认只转发到下面列出的大模型服务（https），--allow 可以再加主机
// （加 127.0.0.1:端口 这样的本机地址时允许 http，用于不能开跨域的本机模型服务）；--any 放开到任意 https 主机。
// 密钥由浏览器随请求带来，中转不保存、不记录请求内容，只在窗口里打印一行“方法 主机 状态 耗时”。
// 需要 Node.js 18 以上。系统设置了 HTTPS_PROXY 时自动让 Node 走代理（Node 24.5 以上支持）。
import http from 'node:http';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
if (args.includes('--help') || args.includes('-h')) {
  console.log('node tools/ai-relay.mjs [--port 8787] [--allow host1,host2] [--any]');
  process.exit(0);
}
// 让 Node 内置的 fetch 使用系统代理：需要在启动时设置 NODE_USE_ENV_PROXY，所以带上它重新启动自己一次
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
if (proxy && !process.env.NODE_USE_ENV_PROXY && !process.env.AI_RELAY_CHILD) {
  const ch = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1', AI_RELAY_CHILD: '1' } });
  ch.on('exit', (c) => process.exit(c ?? 0));
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => ch.kill(s));
} else start();

function start() {
  const PORT = +opt('--port', 8787);
  const ANY = args.includes('--any');
  const ALLOW = new Set([
    'api.anthropic.com', 'api.openai.com', 'api.deepseek.com', 'dashscope.aliyuncs.com', 'api.moonshot.cn',
    'open.bigmodel.cn', 'api.siliconflow.cn', 'openrouter.ai', 'generativelanguage.googleapis.com',
    'ark.cn-beijing.volces.com', 'qianfan.baidubce.com', 'api.hunyuan.cloud.tencent.com', 'api.minimaxi.com', 'api.lingyiwanwu.com', 'api.stepfun.com',
    ...String(opt('--allow', '')).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  ]);
  const loop = (h) => /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(h);
  const allowed = (u) => {
    if (ALLOW.has(u.host.toLowerCase()) || ALLOW.has(u.hostname.toLowerCase())) return u.protocol === 'https:' || loop(u.hostname);
    return ANY && u.protocol === 'https:' && !loop(u.hostname);
  };
  // 不转发给上游的请求头：浏览器身份相关的、逐跳的、让上游再做一次跨域判断的
  const DROP_REQ = /^(host|origin|referer|cookie|connection|keep-alive|content-length|accept-encoding|transfer-encoding|upgrade|te|trailer|proxy-.*|sec-.*|access-control-request-.*)$/i;
  const DROP_RES = /^(content-encoding|content-length|transfer-encoding|connection|keep-alive|set-cookie|access-control-.*|strict-transport-security|alt-svc)$/i;
  const cors = (req) => ({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Expose-Headers': '*',
    'Access-Control-Max-Age': '86400',
  });
  const fail = (req, res, code, msg) => { res.writeHead(code, { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: { message: msg } })); };

  const srv = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors(req)); return res.end(); }
    let target;
    try { target = new URL(req.url.replace(/^\/+/, '')); } catch { return fail(req, res, 400, `中转地址格式：http://127.0.0.1:${PORT}/https://服务商的接口地址`); }
    if (!allowed(target)) return fail(req, res, 403, `中转没有放行 ${target.host}。启动时加 --allow ${target.host}`);
    const t0 = Date.now(), ac = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    try {
      const chunks = []; for await (const c of req) chunks.push(c);
      const headers = {}; for (const [k, v] of Object.entries(req.headers)) if (!DROP_REQ.test(k)) headers[k] = v;
      const up = await fetch(target, { method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks), signal: ac.signal, redirect: 'follow' });
      const out = { ...cors(req) }; up.headers.forEach((v, k) => { if (!DROP_RES.test(k)) out[k] = v; });
      res.writeHead(up.status, out);
      if (up.body) for await (const c of up.body) res.write(c);
      res.end();
      console.log(`${new Date().toLocaleTimeString()}  ${req.method} ${target.host}  ${up.status}  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    } catch (err) {
      if (ac.signal.aborted) return;
      const why = err.cause?.code || err.cause?.message || err.message;
      console.log(`${new Date().toLocaleTimeString()}  ${req.method} ${target.host}  失败：${why}`);
      if (!res.headersSent) fail(req, res, 502, `中转连不上 ${target.host}：${why}`); else res.end();
    }
  });
  srv.on('error', (err) => { console.error(err.code === 'EADDRINUSE' ? `端口 ${PORT} 已被占用（中转可能已经在运行），可以用 --port 换一个。` : err.message); process.exit(1); });
  srv.listen(PORT, '127.0.0.1', () => {
    console.log(`AI 助教中转已启动：http://127.0.0.1:${PORT}/<接口地址>`);
    console.log(`例：http://127.0.0.1:${PORT}/https://open.bigmodel.cn/api/paas/v4`);
    console.log(ANY ? '允许转发到任意 https 主机。' : `允许转发到：${[...ALLOW].join('、')}`);
    if (process.env.NODE_USE_ENV_PROXY) console.log(`经代理 ${proxy} 访问外网。`);
    console.log('关闭这个窗口即停止。');
  });
}
