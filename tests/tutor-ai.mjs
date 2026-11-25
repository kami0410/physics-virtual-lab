// AI 助教的端到端测试：本机起一个模拟大模型服务（Anthropic Messages、OpenAI Chat Completions、Gemini 三种流式格式），
// 模型第 1 轮调 get_history，第 2 轮调 set_control 调仪器，第 3 轮回答文字。检查：学生的操作轨迹传给了模型、
// 工具真的调动了仪器、回答显示在面板里、Gemini 的 thoughtSignature 原样回传。用法：node tests/tutor-ai.mjs（需先 npm run build:single）
import http from 'node:http';
import { chromium } from 'playwright-core';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
const URL0 = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist-single', 'index.html')).href;
let fails = 0;
const expect = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : '  ' + detail}`); };
const log = [];
const srv = http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Expose-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    const j = JSON.parse(body); log.push({ url: req.url, j });
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream' });
    const gem = /generatecontent/i.test(req.url);
    if (req.url.includes('/v1/messages')) {
      const turnA = j.messages.filter((m) => m.role === 'assistant').length;
      const ev = (type, o) => res.write(`event: ${type}
data: ${JSON.stringify({ type, ...o })}

`);
      ev('message_start', { message: { id: 'msg' + turnA, type: 'message', role: 'assistant', model: j.model, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } });
      if (turnA < 2) {
        const [name, input] = turnA === 0 ? ['get_history', { last: '20' }] : ['set_control', { component: 'rig', control: '劈尖 B 的位置', value: '33.2' }];
        const js = JSON.stringify(input);
        ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'toolu_' + turnA, name, input: {} } });
        ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: js.slice(0, 15) } });
        ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: js.slice(15) } });
        ev('content_block_stop', { index: 0 });
        ev('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } });
      } else {
        ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
        ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: '已把劈尖 B 移到 33.2 cm（Claude 格式）。' } });
        ev('content_block_stop', { index: 0 });
        ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } });
      }
      ev('message_stop', {});
      return res.end();
    }
    const turn = gem ? j.contents.filter((c) => c.role === 'model').length : j.messages.filter((m) => m.role === 'assistant').length;
    const send = (o) => res.write('data: ' + JSON.stringify(o) + '\n\n');
    const call = (name, args) => gem ? send({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args }, thoughtSignature: 'sig' + turn }] } }] })
      : (send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c' + turn, type: 'function', function: { name, arguments: '' } }] } }] }), send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args).slice(0, 20) } }] } }] }), send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args).slice(20) } }] } }] }));
    if (turn === 0) call('get_history', { last: '20' });
    else if (turn === 1) call('set_control', { component: 'rig', control: '劈尖 B 的位置', value: '33.2' });
    else { const t = '你把弦长调到了 30 cm，离 2 个波腹的共振还差约 3 cm。我已把劈尖 B 移到 33.2 cm，现在振幅最大，可以记录了。'; for (const s of [t.slice(0, 20), t.slice(20)]) gem ? send({ candidates: [{ content: { role: 'model', parts: [{ text: s }] } }] }) : send({ choices: [{ delta: { content: s } }] }); }
    if (!gem) res.write('data: [DONE]\n\n');
    res.end();
  });
});
await new Promise((r) => srv.listen(8899, '127.0.0.1', r));
let b;
for (const channel of ['chrome', 'msedge']) { try { b = await chromium.launch({ channel, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }); break; } catch { /* 下一个 */ } }
for (const fmt of ['anthropic', 'openai', 'gemini']) {
  log.length = 0;
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript((f) => localStorage.setItem('tutorAI', JSON.stringify({ preset: 'custom', format: f, base: 'http://127.0.0.1:8899' + (f === 'openai' ? '/v1' : ''), model: 'mock', key: 'k' })), fmt);
  await p.goto(URL0 + '#/exp/stringwave');
  await p.waitForTimeout(2500);
  await p.evaluate(async () => { const a = window.__app; a.speed = 8; await a.runStep(0); });
  await p.evaluate(() => { const a = window.__app, c = a.comp('rig'); a.select(c); });
  await p.waitForTimeout(300);
  // 学生自己拧旋钮：通过检查器的控件回调（记录进操作轨迹）
  await p.evaluate(() => { const a = window.__app, t = a.tutor, c = a.comp('rig'), d = c.controls()[0]; d.set(30); t.track(c, d); });
  await p.click('[data-a=tutor]');
  await p.fill('.tutor textarea', '为什么弦不怎么振动？');
  await p.click('.tutor form button[type=submit], .tutor form button');
  await p.waitForTimeout(5000);
  const L = await p.evaluate(() => window.__app.exp.L.toFixed(2));
  const chat = await p.evaluate(() => [...document.querySelectorAll('.tutor .tt-msg, .tutor .tt-chat > *')].map((e) => e.innerText.replace(/\s+/g, ' ')).join(' ‖ ').slice(-700));
  const histRes = fmt === 'anthropic' ? JSON.stringify(log[1]?.j.messages.at(-1)) : fmt === 'openai' ? log[1]?.j.messages.find((m) => m.role === 'tool')?.content : JSON.stringify(log[1]?.j.contents.at(-1));
  expect(`${fmt}：三轮请求`, log.length === 3, `实际 ${log.length} 次`);
  expect(`${fmt}：第一条消息附带实验状态`, /当前实验状态/.test(JSON.stringify(fmt === 'gemini' ? log[0].j.contents[0] : fmt === 'anthropic' ? log[0].j.messages[0] : log[0].j.messages[1])));
  expect(`${fmt}：get_history 返回了学生的操作“40 → 30”`, String(histRes).includes('40 → 30'), String(histRes).slice(0, 200));
  expect(`${fmt}：set_control 把劈尖 B 调到 33.20 cm`, L === '33.20', `L = ${L}`);
  expect(`${fmt}：回答显示在面板`, chat.includes('33.2 cm'), chat.slice(-200));
  if (fmt === 'gemini') expect('gemini：回传 thoughtSignature', JSON.stringify(log[1].j.contents).includes('sig0'));
  expect(`${fmt}：页面无报错`, !errs.length, errs.join('; '));
  await p.close();
}
await b.close(); srv.close();
console.log(fails ? `\nAI 助教：${fails} 项未通过` : '\nAI 助教：全部通过');
process.exit(fails ? 1 : 0);
