// Windows 桌面版启动器（打包成 PhysicsLab.exe，见 desktop/build-exe.mjs）
//
// 双击 exe 后：
//   1. 在本机 127.0.0.1:5180 起一个只给自己用的小服务器，提供离线单文件版页面（打包在 exe 里）
//      和 AI 助教的内置中转（/__ai-relay/，与 npm run dev 时相同）；
//   2. 用 Edge（没有 Edge 时用 Chrome）的“应用窗口”模式打开页面：没有地址栏和标签页，看起来就是一个独立程序；
//   3. 窗口关闭后，服务器随之退出。
// 已经开着一个时再双击，只会再开一个窗口，不会重复起服务器。
// 浏览器数据（AI 设置、读数习惯等）放在 %LOCALAPPDATA%\PhysicsLab，与用户日常的浏览器互不影响。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { relayHandler, RELAY_ID } from '../tools/ai-relay-core.mjs';

const PORT = 5180;
const HOME = path.join(process.env.LOCALAPPDATA || process.env.APPDATA || '.', 'PhysicsLab');
fs.mkdirSync(HOME, { recursive: true });
const LOG = path.join(HOME, 'launcher.log');
const log = (s) => { try { fs.appendFileSync(LOG, `${new Date().toISOString()}  ${s}\n`); } catch { /* 忽略 */ } };

/** exe 是窗口程序（没有控制台），出错时弹一个对话框 */
function alertBox(msg) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const ps = `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(${q(msg)}, ${q('大学物理实验虚拟仿真')}) | Out-Null`;
  try { spawn('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, stdio: 'ignore' }).on('exit', () => process.exit(1)); } catch { process.exit(1); }
}

// 页面每 20 秒报一次平安；所有窗口都关掉、超过 3 分钟没有消息时服务器退出
// （窗口最小化时浏览器会把定时器放慢到每分钟一次，所以留足余量）
const BEAT = `<script>setInterval(()=>fetch('/__physlab/beat',{cache:'no-store'}).catch(()=>{}),20000)</script>`;

/** 页面：打包在 exe 里的 dist-single/index.html（开发时也可以直接 node 运行本文件，读磁盘上的） */
function loadPage() {
  let html;
  try { const sea = process.getBuiltinModule('node:sea'); if (sea.isSea()) html = Buffer.from(sea.getAsset('index.html')).toString('utf8'); } catch { /* 不是打包后的 exe */ }
  if (html == null) html = fs.readFileSync(new URL('../dist-single/index.html', import.meta.url), 'utf8');
  const i = html.lastIndexOf('</body>');
  return Buffer.from(i >= 0 ? html.slice(0, i) + BEAT + html.slice(i) : html + BEAT);
}

let lastHit = Date.now();
function serve(page, port) {
  const relay = relayHandler({ sameOrigin: true, log });
  const srv = http.createServer((req, res) => {
    lastHit = Date.now();
    if (req.url.startsWith('/__ai-relay')) { req.url = req.url.slice('/__ai-relay'.length) || '/'; return relay(req, res); }
    if (req.url.startsWith('/__physlab/beat')) { res.writeHead(204); return res.end(); }
    if (req.url === '/__physlab') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ app: RELAY_ID })); }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    if (req.url !== '/' && !req.url.startsWith('/?') && !req.url.startsWith('/index.html')) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : page);
  });
  return new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(port, '127.0.0.1', () => resolve(srv)); });
}

/** 这个端口上是不是已经有一个本程序在运行 */
async function ours(port) {
  try { const r = await fetch(`http://127.0.0.1:${port}/__physlab`, { signal: AbortSignal.timeout(1000) }); return (await r.json()).app === RELAY_ID; } catch { return false; }
}

function findBrowser() {
  const pf = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  const cands = [];
  for (const p of pf) cands.push(path.join(p, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  for (const p of pf) cands.push(path.join(p, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  return cands.find((f) => fs.existsSync(f)) || null;
}

/** 以应用窗口打开；返回浏览器进程（找不到 Edge/Chrome 时用默认浏览器打开，返回 null） */
function openWindow(url) {
  const exe = findBrowser();
  if (!exe) { spawn('cmd.exe', ['/c', 'start', '""', url], { windowsHide: true, stdio: 'ignore' }); return null; }
  const args = [`--app=${url}`, `--user-data-dir=${path.join(HOME, 'browser')}`, '--no-first-run', '--no-default-browser-check',
    '--disable-background-mode', '--disable-features=msEdgeStartupBoost,Translate', '--window-size=1440,900', '--lang=zh-CN'];
  return spawn(exe, args, { stdio: 'ignore', windowsHide: false });
}

async function main() {
  let port = PORT, srv = null;
  try { srv = await serve(loadPage(), port); } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;
    if (await ours(port)) { log('已在运行，只打开新窗口'); openWindow(`http://127.0.0.1:${port}/`); setTimeout(() => process.exit(0), 3000); return; }
    srv = await serve(loadPage(), 0); port = srv.address().port; // 5180 被别的程序占了：换一个空闲端口（这次的设置不会和上次共用）
    log(`端口 ${PORT} 被占用，改用 ${port}`);
  }
  log(`启动 http://127.0.0.1:${port}/`);
  const t0 = Date.now(), br = openWindow(`http://127.0.0.1:${port}/`);
  if (br) {
    // 浏览器进程自己开着窗口时，它退出就说明窗口关了；若它把窗口交给了已在运行的同一配置的进程（几秒内就退出），改靠心跳判断
    br.on('exit', () => { if (Date.now() - t0 > 8000) { log('窗口已关闭，退出'); process.exit(0); } });
    br.on('error', (e) => { log('打开浏览器失败：' + e.message); alertBox('打开窗口失败：' + e.message); });
  }
  setInterval(() => { if (Date.now() - lastHit > 3 * 60e3) { log('没有窗口了，退出'); process.exit(0); } }, 30e3);
}

main().catch((err) => { log('出错：' + (err.stack || err.message)); alertBox('启动失败：' + err.message + '\n详细信息见 ' + LOG); });
