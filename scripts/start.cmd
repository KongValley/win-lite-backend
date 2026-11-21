@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

rem Prefer a node.exe placed in the project root (portable distribution).
if exist "node.exe" set "PATH=%CD%;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH.
  echo         Install Node.js 22 LTS x86 for 32-bit Windows or Node.js LTS x64 for 64-bit Windows.
  echo         Download: https://nodejs.org/en/download
  exit /b 1
)

if not exist "dist\index.js" (
  echo [ERROR] Compiled server not found: dist\index.js
  echo         Run "npm install" and "npm run build" first.
  exit /b 1
)

for /f "delims=" %%V in ('node --version 2^>nul') do set "NODE_VERSION=%%V"
echo [win-lite-backend] Node.js %NODE_VERSION%
echo [win-lite-backend] Starting server (Ctrl+C to stop)...
echo.

node "dist\index.js"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Server exited with code %EXIT_CODE%.
)

exit /b %EXIT_CODE%
