@echo off
setlocal enabledelayedexpansion

set "REPO_URL=https://github.com/NasreddinHodja/konigslibrary"
set "NODE_VERSION=22.16.0"
set "MIN_NODE=22"

cd /d "%~dp0"

:: ---------- 1. ensure Node >= 22 ----------
set "NODE_MAJOR=0"
where node >nul 2>&1
if %errorlevel%==0 (
  for /f "tokens=1 delims=v." %%a in ('node -v') do set "NODE_MAJOR=%%a"
  if !NODE_MAJOR! geq %MIN_NODE% (
    goto :has_node
  )
)

if exist "node\node.exe" (
  set "PATH=%~dp0node;%PATH%"
  goto :has_node
)

echo =^> Downloading Node.js %NODE_VERSION% (win-x64)...
set "ZIP=node-v%NODE_VERSION%-win-x64.zip"
set "URL=https://nodejs.org/dist/v%NODE_VERSION%/%ZIP%"
curl -fSL "%URL%" -o "%ZIP%"
if %errorlevel% neq 0 (
  echo ERROR: Failed to download Node.js
  pause
  exit /b 1
)

echo =^> Extracting Node.js...
mkdir node 2>nul
tar -xf "%ZIP%" --strip-components=1 -C node
del "%ZIP%"
set "PATH=%~dp0node;%PATH%"

:has_node
for /f "tokens=*" %%v in ('node -v') do echo =^> Using %%v

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
call npm install --no-fund --no-audit
if %errorlevel% neq 0 (
  echo ERROR: npm install failed
  pause
  exit /b 1
)

echo =^> Building (adapter-node)...
set "LOCAL_BUILD=1"
call npm run build
if %errorlevel% neq 0 (
  echo ERROR: Build failed
  pause
  exit /b 1
)

echo =^> Build complete.

:: ---------- 3. launch ----------
:launch
echo =^> Starting server...
node server.js
pause
