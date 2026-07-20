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
if not defined NODE_CMD (
  echo Node.js 18 or newer is required and was not found.
  where winget >nul 2>nul
  if not errorlevel 1 (
    set /p "INSTALL_NODE=Download and install Node.js LTS automatically now? [Y/n]: "
    if "!INSTALL_NODE!"=="" set "INSTALL_NODE=Y"
    if /i "!INSTALL_NODE!"=="Y" (
      winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements --silent
      if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_CMD=%ProgramFiles%\nodejs\node.exe"
      if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_CMD=%LOCALAPPDATA%\Programs\nodejs\node.exe"
      if not defined NODE_CMD where node >nul 2>nul && set "NODE_CMD=node"
    )
  )
  if not defined NODE_CMD (
    echo ERROR: Automatic Node.js installation was declined, failed, or winget is unavailable.
    echo Install Node.js 18 or newer, then run uie.bat again.
    pause
    exit /b 1
  )
)

set "PY_CMD="
set "PYTHON="
if exist "%ROOT%.venv\Scripts\python.exe" (
  echo Local virtual environment .venv found. Using virtual environment python.
  set "PY_CMD=%ROOT%.venv\Scripts\python.exe"
  set "PYTHON=%ROOT%.venv\Scripts\python.exe"
) else if exist "%ROOT%venv\Scripts\python.exe" (
  echo Local virtual environment venv found. Using virtual environment python.
  set "PY_CMD=%ROOT%venv\Scripts\python.exe"
  set "PYTHON=%ROOT%venv\Scripts\python.exe"
) else (
  where py >nul 2>nul
  if not errorlevel 1 (
    for %%V in (3.13 3.12 3.11 3.10) do (
      if not defined PY_CMD (
        py -%%V -c "import sys" >nul 2>nul
        if not errorlevel 1 (
          set "PY_CMD=py -%%V"
          set "PYTHON=py"
        )
      )
    )
  )
  if not defined PY_CMD (
    where python >nul 2>nul
    if not errorlevel 1 (
      python -c "import sys; raise SystemExit(0 if sys.version_info[:2] >= (3,10) and sys.version_info[:2] <= (3,13) else 1)" >nul 2>nul
      if not errorlevel 1 (
        set "PY_CMD=python"
        set "PYTHON=python"
      )
    )
  )
)

if not defined PY_CMD (
  echo Python 3.10-3.13 is needed to create .venv and enable all game systems.
  where winget >nul 2>nul
  if not errorlevel 1 (
    set /p "INSTALL_PYTHON=Download and install Python 3.13 automatically now? [Y/n]: "
    if "!INSTALL_PYTHON!"=="" set "INSTALL_PYTHON=Y"
    if /i "!INSTALL_PYTHON!"=="Y" (
      winget install --id Python.Python.3.13 -e --source winget --accept-package-agreements --accept-source-agreements --silent
      if exist "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" (
        set "PY_CMD=%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
        set "PYTHON=%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
      )
      if exist "%ProgramFiles%\Python313\python.exe" (
        set "PY_CMD=%ProgramFiles%\Python313\python.exe"
        set "PYTHON=%ProgramFiles%\Python313\python.exe"
      )
      if not defined PY_CMD (
        where py >nul 2>nul
        if not errorlevel 1 (
          py -3.13 -c "import sys" >nul 2>nul
          if not errorlevel 1 (
            set "PY_CMD=py -3.13"
            set "PYTHON=py"
          )
        )
      )
    )
  )
)

:: 0. Check the configured GitHub remote and ask before updating.
if defined NODE_CMD (
  "%NODE_CMD%" "%ROOT%scripts\launcher-maintenance.mjs" --updates
)
echo.

:: 1. Install Node dependencies only when declared dependencies change.
echo [1/3] Checking Node.js dependencies...
if defined NODE_CMD (
  "%NODE_CMD%" "%ROOT%scripts\launcher-maintenance.mjs" --npm
) else (
  echo Node.js not found. The launcher cannot start the main dev server.
)
echo.

:: 2. Prepare and validate the isolated project-local .venv before the game opens.
echo [2/3] Checking the project-local Python environment...
set "VENV_READY=0"
if defined PY_CMD (
  "%NODE_CMD%" "%ROOT%dev-server.mjs" --prepare-only --no-image-service
  if errorlevel 1 (
    echo.
    echo ERROR: .venv setup did not complete. VoiceBridge and backend game systems are not ready.
    echo Run this launcher again or use: npm run backend:install
    set /p "START_OFFLINE=Continue in reduced offline/procedural mode anyway? [y/N]: "
    if /i "!START_OFFLINE!"=="Y" (
      set "UIE_AUTO_START_BACKEND=0"
    ) else (
      echo Startup cancelled so the game does not open partially initialized.
      pause
      exit /b 1
    )
  ) else (
    if exist "%ROOT%.venv\Scripts\python.exe" (
      set "PY_CMD=%ROOT%.venv\Scripts\python.exe"
      set "PYTHON=%ROOT%.venv\Scripts\python.exe"
      set "VENV_READY=1"
    )
  )
) else (
  echo Automatic Python installation was declined, failed, or winget is unavailable.
  echo Install Python 3.10-3.13 and run uie.bat again. Continuing now uses reduced offline/procedural mode.
  set "UIE_AUTO_START_BACKEND=0"
)
echo.

:: 2.5. Optional KOJI local image generation model
:: Record the first response so startup never repeatedly asks about this optional download.
set "KOJI_PROMPT_MARKER=%ROOT%data\.koji-install-choice-recorded"
if not exist "%KOJI_PROMPT_MARKER%" (
  if "%VENV_READY%"=="1" (
    if not exist "%ROOT%models\koji\koji_v21.safetensors" if not exist "%ROOT%models\koji\koji_v21-q4_k_m.gguf" (
      echo.
      echo [Optional] KOJI Local Image Generation Model
      echo   Size: approximately 2.5 GB from HuggingFace: calcuis/koji
      echo   No API key required once installed. You can install it later in Settings.
      set /p "INSTALL_KOJI=Install KOJI image gen now? [Y/N]: "
      > "%KOJI_PROMPT_MARKER%" echo choice-recorded
      if /i "!INSTALL_KOJI!"=="Y" (
        echo Starting KOJI download in the background. Check Settings - Visual Gen for progress.
        start "" /B "%PY_CMD%" -c "import sys,logging,time; sys.path.insert(0, r'%ROOT%'); logging.basicConfig(level=logging.INFO); from python.visuals.download_koji import download_koji; download_koji(); time.sleep(1)"
      ) else (
        echo Skipping KOJI image gen install. You can install it later from Settings.
      )
    )
  )
)
echo.

:: 3. Terminate port conflicts
echo [3/3] Preparing server on port %PORT%...
echo Starting local dev server...
echo Serving on: http://localhost:%PORT%/game.html
echo.

if defined NODE_CMD (
  "%NODE_CMD%" "%ROOT%dev-server.mjs" --host 0.0.0.0 --port %PORT% --open
) else if defined PY_CMD (
  echo Node.js not found; using Python fallback server.
  "%PY_CMD%" -m http.server %PORT% --bind localhost --directory "%ROOT%"
) else (
  echo Neither Node.js nor Python was found on PATH.
  echo Install Node.js or Python, then run this file again.
  pause
  exit /b 1
)

set "UIE_EXIT=%ERRORLEVEL%"
if "%UIE_EXIT%"=="3" (
  echo.
  echo Existing UIE server reused successfully. Press any key when you are done reading this status.
  pause
  exit /b 0
)

if not "%UIE_EXIT%"=="0" (
  echo.
  echo UIE stopped with an error. Review any error shown above.
  pause
  exit /b %UIE_EXIT%
)

echo.
echo UIE stopped normally.
echo Press any key to close this launcher window.
pause
exit /b 0
