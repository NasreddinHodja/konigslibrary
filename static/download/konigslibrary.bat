@echo off
setlocal enabledelayedexpansion

set "REPO_URL=https://github.com/NasreddinHodja/konigslibrary"
set "BUN_VERSION=1.2.15"

cd /d "%~dp0"

:: ---------- 1. ensure bun ----------
where bun >nul 2>&1
if %errorlevel%==0 goto :has_bun

if exist "bun\bun.exe" (
  set "PATH=%~dp0bun;%PATH%"
  goto :has_bun
)

echo =^> Downloading Bun %BUN_VERSION% (win-x64)...
set "ZIP=bun-windows-x64.zip"
set "URL=https://github.com/oven-sh/bun/releases/download/bun-v%BUN_VERSION%/%ZIP%"
curl -fSL "%URL%" -o "%ZIP%"
if %errorlevel% neq 0 (
  echo ERROR: Failed to download Bun
  pause
  exit /b 1
)

echo =^> Extracting Bun...
mkdir bun 2>nul
tar -xf "%ZIP%" --strip-components=1 -C bun
del "%ZIP%"
set "PATH=%~dp0bun;%PATH%"

:has_bun
for /f "tokens=*" %%v in ('bun --version') do echo =^> Using Bun %%v

:: ---------- 2. get the app source + build ----------
if exist "build\" goto :launch

echo =^> Downloading konigslibrary source...
curl -fSL "%REPO_URL%/archive/refs/heads/main.zip" -o repo.zip
if %errorlevel% neq 0 (
  echo ERROR: Failed to download source
  pause
  exit /b 1
)

echo =^> Extracting source...
tar -xf repo.zip --strip-components=1
del repo.zip

echo =^> Installing dependencies...
call bun install --frozen-lockfile
if %errorlevel% neq 0 (
  echo ERROR: bun install failed
  pause
  exit /b 1
)

echo =^> Building (adapter-node)...
set "LOCAL_BUILD=1"
call bun run build
if %errorlevel% neq 0 (
  echo ERROR: Build failed
  pause
  exit /b 1
)

echo =^> Build complete.

:: ---------- 3. launch ----------
:launch
echo =^> Starting server...
bun server.js
pause
