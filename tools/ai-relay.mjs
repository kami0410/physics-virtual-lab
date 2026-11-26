#!/usr/bin/env node
// AI 助教的本机中转：给不允许网页直接访问（不响应跨域预检）的大模型接口补上跨域许可。
// 助教会自动探测它：直连失败时自动改走中转，不用手改接口地址。
//
//   node tools/ai-relay.mjs              在当前窗口运行（关窗口即停止）
//   node tools/ai-relay.mjs --install    设为开机自动在后台运行，并立即启动（npm run relay:install）
//   node tools/ai-relay.mjs --uninstall  取消开机自启并停止后台中转（npm run relay:uninstall）
//   其他选项：--port 8787  --allow 主机1,主机2  --any（放开到任意 https 主机）
//            --origin https://你的网站（默认只接受离线版 file://、本机页面和在线版发来的请求）
//
// 只监听本机 127.0.0.1，默认只转发到常见的大模型服务。密钥由浏览器随请求带来，中转不保存、不记录请求内容。
// 系统设置了 HTTPS_PROXY 时自动走代理（Node 24 起支持）。需要 Node.js 18 以上。
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { relayHandler, useEnvProxy, DEFAULT_HOSTS, RELAY_ID } from './ai-relay-core.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const PORT = +opt('--port', 8787);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const NAME = 'physlab-ai-relay';
const HOME_DIR = process.platform === 'win32' ? path.join(process.env.APPDATA || os.homedir(), NAME) : path.join(os.homedir(), '.' + NAME);
const quiet = !process.stdout.isTTY && args.includes('--background');

/** 本机这个端口上是不是已经有中转在运行 */
async function running() {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/__relay`, { signal: AbortSignal.timeout(800) }); return (await r.json()).relay === RELAY_ID; } catch { return false; }
}

function serve() {
  const allow = String(opt('--allow', '')).split(',').filter(Boolean), any = args.includes('--any');
  const origins = String(opt('--origin', '')).split(',').filter(Boolean);
  const h = relayHandler({ allow, origins, any, log: quiet ? undefined : (l) => console.log(l) });
  const srv = http.createServer((req, res) => { h(req, res); });
  srv.on('error', async (err) => {
    if (err.code === 'EADDRINUSE' && (await running())) { if (!quiet) console.log(`中转已经在运行（127.0.0.1:${PORT}），不用再启动。`); process.exit(0); }
    console.error(err.code === 'EADDRINUSE' ? `端口 ${PORT} 被别的程序占用了，可以用 --port 换一个。` : err.message);
    process.exit(1);
  });
  srv.listen(PORT, '127.0.0.1', () => {
    if (quiet) return;
    console.log(`AI 助教中转已启动：http://127.0.0.1:${PORT}（助教会自动使用，不用改设置）`);
    console.log(any ? '允许转发到任意 https 主机。' : `允许转发到：${[...DEFAULT_HOSTS, ...allow].join('、')}`);
    const p = useEnvProxy(); if (p) console.log(`经代理 ${p} 访问外网。`);
    console.log('关闭这个窗口即停止。想开机自动在后台运行：node tools/ai-relay.mjs --install');
  });
}

// ---------------------------------------------------------------- 开机自启
const startupFile = () => {
  if (process.platform === 'win32') return path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', `${NAME}.vbs`);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'LaunchAgents', `com.${NAME}.plist`);
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart', `${NAME}.desktop`);
};
const extra = () => args.filter((a) => a !== '--install' && a !== '--uninstall');

async function install() {
  // 把中转复制到固定位置，项目文件夹以后移动、删除都不影响
  fs.mkdirSync(HOME_DIR, { recursive: true });
  for (const f of ['ai-relay.mjs', 'ai-relay-core.mjs']) fs.copyFileSync(path.join(HERE, f), path.join(HOME_DIR, f));
  const script = path.join(HOME_DIR, 'ai-relay.mjs'), node = process.execPath, cmd = [node, script, '--background', ...extra()];
  const file = startupFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (process.platform === 'win32') {
    // 用 wscript 隐藏窗口启动；文件存成带 BOM 的 UTF-16，路径里有中文也不会乱码
    const q = (s) => `""${s}""`;
    const vbs = `CreateObject("WScript.Shell").Run "${cmd.map(q).join(' ')}", 0, False\r\n`;
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(vbs, 'utf16le')]));
  } else if (process.platform === 'darwin') {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    fs.writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.${NAME}</string>
  <key>ProgramArguments</key><array>${cmd.map((a) => `<string>${esc(a)}</string>`).join('')}</array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
`);
  } else {
    fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=物理实验 AI 助教中转\nExec=${cmd.map((a) => `"${a}"`).join(' ')}\nX-GNOME-Autostart-enabled=true\nNoDisplay=true\n`);
  }
  console.log(`已设为开机自动运行：${file}`);
  if (await running()) return console.log('中转已经在运行。');
  if (process.platform === 'darwin') { try { execFileSync('launchctl', ['load', '-w', file]); } catch { /* 下次登录时启动 */ } }
  else spawn(cmd[0], cmd.slice(1), { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 20 && !(await running()); i++) await new Promise((r) => setTimeout(r, 150));
  console.log((await running()) ? `中转已在后台启动（127.0.0.1:${PORT}）。取消：node tools/ai-relay.mjs --uninstall` : '中转没能立即启动，下次登录时会自动运行。');
}

async function uninstall() {
  const file = startupFile();
  if (process.platform === 'darwin' && fs.existsSync(file)) { try { execFileSync('launchctl', ['unload', '-w', file]); } catch { /* 没在运行 */ } }
  if (fs.existsSync(file)) { fs.rmSync(file); console.log(`已取消开机自启：${file}`); } else console.log('没有设置过开机自启。');
  // 停掉后台运行的中转（只认我们自己复制出去的那份）
  const marker = path.join(HOME_DIR, 'ai-relay.mjs');
  try {
    if (process.platform === 'win32') {
      const ps = `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*${marker.replace(/'/g, "''")}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
      execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
    } else execFileSync('pkill', ['-f', marker], { stdio: 'ignore' });
  } catch { /* 没有在运行 */ }
  for (let i = 0; i < 10 && (await running()); i++) await new Promise((r) => setTimeout(r, 150));
  console.log((await running()) ? `127.0.0.1:${PORT} 上还有中转在运行（可能是在某个窗口里手动启动的），关掉那个窗口即可。` : '后台中转已停止。');
  fs.rmSync(HOME_DIR, { recursive: true, force: true });
}

// ---------------------------------------------------------------- 入口（放在最后：上面的常量都已初始化）
if (args.includes('--help') || args.includes('-h')) {
  console.log('node tools/ai-relay.mjs [--install | --uninstall] [--port 8787] [--allow host1,host2] [--any]');
} else if (args.includes('--install')) await install();
else if (args.includes('--uninstall')) await uninstall();
else serve();
