@echo off
setlocal
rem Hajimarijima poster app: start the local server, then open Chrome in app mode.
rem The app window uses its own profile (.poster-app-profile). Posting automation keeps .poster-profile.
cd /d "%~dp0"
set "APPDIR=%~dp0tools\poster\app"
set "PORTFILE=%APPDIR%\.port"
if exist "%PORTFILE%" del "%PORTFILE%" >nul 2>&1

where node >nul 2>&1
if errorlevel 1 goto nonode

start "hajimarijima-poster-server" /min node "%APPDIR%\server.js"

set /a N=0
:wait
if exist "%PORTFILE%" goto ready
set /a N+=1
if %N% geq 30 goto noport
timeout /t 1 /nobreak >nul
goto wait

:ready
set /p PORT=<"%PORTFILE%"

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" goto nochrome

start "" "%CHROME%" --app=http://127.0.0.1:%PORT%/ --user-data-dir="%~dp0.poster-app-profile" --window-size=560,940 --no-first-run --no-default-browser-check
exit /b 0

:nonode
echo Node.js was not found. Please install Node.js.
pause
exit /b 1

:noport
echo The server did not start. Check the minimized "hajimarijima-poster-server" window.
pause
exit /b 1

:nochrome
echo Google Chrome was not found. Open http://127.0.0.1:%PORT%/ in a browser.
pause
exit /b 1
