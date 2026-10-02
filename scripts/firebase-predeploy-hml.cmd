@echo off
setlocal
call npm.cmd run test
if errorlevel 1 exit /b %errorlevel%
call npm.cmd run build
exit /b %errorlevel%
