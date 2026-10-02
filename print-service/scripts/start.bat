@echo off
setlocal
cd /d "%~dp0\.."
if not exist node_modules (
  echo Dependencias ausentes. Execute npm install primeiro.
  pause
  exit /b 1
)
node src\index.js
if errorlevel 1 pause

