@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js 22 or 24.
  pause
  exit /b 1
)
if not exist "node_modules\three\build\three.module.js" (
  echo Installing website dependencies...
  call npm.cmd install --no-audit --no-fund
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)
node scripts/start-model.mjs
pause
