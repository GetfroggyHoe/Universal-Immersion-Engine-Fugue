@echo off
setlocal EnableExtensions EnableDelayedExpansion
title UIE: Fugue Server
set "ROOT=%~dp0"
set "PORT=8093"

echo ==================================================
echo  Starting Universal Immersion Engine: Fugue
echo ==================================================
echo.

set "NODE_CMD="
where node >nul 2>nul && set "NODE_CMD=node"

set "PY_CMD="
where py >nul 2>nul && set "PY_CMD=py -3"
if not defined PY_CMD (
  where python >nul 2>nul && set "PY_CMD=python"
)

:: 1. Install Node dependencies if Node is available
echo [1/3] Checking Node.js dependencies...
if defined NODE_CMD (
  echo Node.js found. Ensuring dependencies are installed...
  call npm install
) else (
  echo Node.js not found. Skipping npm install.
)
echo.

:: 2. Install Python dependencies if Python is available
echo [2/3] Checking Python dependencies...
if defined PY_CMD (
  if exist "%ROOT%python\requirements.txt" (
    echo Python found.
    set "PY_REQ_CHECK=%TEMP%\uie-pip-check-%RANDOM%.txt"
    %PY_CMD% -m pip install --dry-run --disable-pip-version-check -r "%ROOT%python\requirements.txt" > "!PY_REQ_CHECK!" 2>&1
    findstr /C:"Would install" /C:"Collecting " /C:"Downloading " /C:"ERROR:" "!PY_REQ_CHECK!" >nul 2>nul
    if !ERRORLEVEL! equ 0 (
      type "!PY_REQ_CHECK!"
      set /p "INSTALL_PY=Python requirements have missing updates. Install/update them before starting the game? [Y/N]: "
      if /i "!INSTALL_PY!"=="Y" (
        echo Installing voice/backend dependencies...
        %PY_CMD% -m pip install -r "%ROOT%python\requirements.txt"
        if !ERRORLEVEL! neq 0 (
          echo WARNING: Python pip install failed. Backend features may not be fully available.
        )
      ) else (
        echo Skipping Python package installation by request.
      )
    ) else (
      echo Python requirements are already satisfied.
    )
    if exist "!PY_REQ_CHECK!" del "!PY_REQ_CHECK!" >nul 2>nul
  ) else (
    echo python\requirements.txt not found.
  )
) else (
  echo Python not found. Skipping backend package installation.
)
echo.

:: 2.5. Optional KOJI local image generation model
:: Record the first response so startup never repeatedly asks about this optional download.
set "KOJI_PROMPT_MARKER=%ROOT%data\.koji-install-choice-recorded"
if not exist "%KOJI_PROMPT_MARKER%" (
  if defined PY_CMD (
    if not exist "%ROOT%models\koji\koji_v21.safetensors" if not exist "%ROOT%models\koji\koji_v21-q4_k_m.gguf" (
      echo.
      echo [Optional] KOJI Local Image Generation Model
      echo   Size: approximately 2.5 GB from HuggingFace: calcuis/koji
      echo   No API key required once installed. You can install it later in Settings.
      set /p "INSTALL_KOJI=Install KOJI image gen now? [Y/N]: "
      > "%KOJI_PROMPT_MARKER%" echo choice-recorded
      if /i "!INSTALL_KOJI!"=="Y" (
        echo Starting KOJI download in the background. Check Settings - Visual Gen for progress.
        start "" /B %PY_CMD% -c "import sys,logging,time; sys.path.insert(0, r'%ROOT%'); logging.basicConfig(level=logging.INFO); from python.visuals.download_koji import download_koji; download_koji(); time.sleep(1)"
      ) else (
        echo Skipping KOJI image gen install. You can install it later from Settings.
      )
    )
  )
)
echo.

:: 3. Terminate port conflicts
echo [3/3] Preparing server on port %PORT%...
set "PORT_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  if not defined PORT_PID set "PORT_PID=%%P"
)

if defined PORT_PID (
  echo Port %PORT% is already in use by PID %PORT_PID%.
  echo Terminating conflicting process...
  taskkill /F /PID %PORT_PID% >nul 2>&1
  timeout /t 1 /nobreak >nul
)

echo Starting local dev server...
echo Serving on: http://localhost:%PORT%/game.html
echo.
start "" "http://localhost:%PORT%/game.html"

if defined NODE_CMD (
  %NODE_CMD% "%ROOT%dev-server.mjs" --host 0.0.0.0 --port %PORT%
) else if defined PY_CMD (
  echo Node.js not found; using Python fallback server.
  %PY_CMD% -m http.server %PORT% --bind localhost --directory "%ROOT%"
) else (
  echo Neither Node.js nor Python was found on PATH.
  echo Install Node.js or Python, then run this file again.
  pause
  exit /b 1
)
pause
