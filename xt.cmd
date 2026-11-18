@echo off
setlocal DisableDelayedExpansion
set "ROOT=%~dp0"
set "NODE_BIN=%ROOT%runtime\node.exe"
if exist "%NODE_BIN%" goto run
node.exe -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" >nul 2>&1
if errorlevel 1 goto download
set "NODE_BIN=node.exe"
goto run
:download
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\get-node.ps1"
if errorlevel 1 exit /b 1
:run
if not "%~1"=="" goto args
"%NODE_BIN%" "%ROOT%bin\xt.js" open
exit /b %errorlevel%
:args
"%NODE_BIN%" "%ROOT%bin\xt.js" %*
exit /b %errorlevel%
