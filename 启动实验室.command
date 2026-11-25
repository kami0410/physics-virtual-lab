#!/bin/sh
# 一键启动（macOS 双击 / Linux 终端运行）：已经在运行就直接打开浏览器；否则启动本机服务器并自动打开浏览器。
# 服务器里内置了 AI 助教的中转，不用另外启动。用完关闭这个窗口即可。
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "没有找到 Node.js。请先到 https://nodejs.org 下载安装 LTS 版。"; read _; exit 1
fi
if curl -s -m 2 http://127.0.0.1:5173/__ai-relay/ 2>/dev/null | grep -q physlab-ai-relay; then
  echo "实验室已经在运行，正在打开浏览器……"
  open http://127.0.0.1:5173/ 2>/dev/null || xdg-open http://127.0.0.1:5173/ >/dev/null 2>&1
  exit 0
fi
if [ ! -d node_modules/vite ]; then
  echo "第一次运行，正在安装依赖，大约需要一两分钟……"
  npm install || { echo "安装依赖失败，请检查网络后再试。"; read _; exit 1; }
fi
echo "正在启动实验室，浏览器会自动打开。用完关闭这个窗口即可。"
exec npm run dev -- --open
