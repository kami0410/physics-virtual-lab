@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 大学物理实验虚拟仿真
rem 一键启动：已经在运行就直接打开浏览器；否则启动本机服务器并自动打开浏览器（第一次会先安装依赖）。
rem 服务器里内置了 AI 助教的中转，不用另外启动。用完关闭这个窗口即可。

where node >nul 2>nul
if errorlevel 1 (
  echo 没有找到 Node.js。请先到 https://nodejs.org 下载安装 LTS 版，装好后再双击本文件。
  pause
  exit /b 1
)

curl -s -m 2 http://127.0.0.1:5173/__ai-relay/ 2>nul | findstr /c:"physlab-ai-relay" >nul
if not errorlevel 1 (
  echo 实验室已经在运行，正在打开浏览器……
  call :open http://127.0.0.1:5173/
  exit /b 0
)

if not exist "node_modules\vite\" (
  echo 第一次运行，正在安装依赖，大约需要一两分钟……
  call npm install
  if errorlevel 1 (
    echo 安装依赖失败，请检查网络后再试。
    pause
    exit /b 1
  )
)

echo 正在启动实验室，浏览器会自动打开。用完关闭这个窗口即可。
call npm run dev -- --open
if errorlevel 1 pause
exit /b

:open
if defined PHYSLAB_NO_BROWSER (
  echo [测试：不打开浏览器] %1
  exit /b 0
)
start "" %1
exit /b 0
