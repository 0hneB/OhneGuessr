@echo off
rem Double-click to play. Serves the built app over http:// and opens the browser.
rem Runs windowless via pythonw; use stop.bat to stop it.
cd /d "%~dp0.."
where pythonw >nul 2>nul
if %errorlevel%==0 (
  start "" pythonw "%~dp0..\server\serve.py"
) else (
  start "" /min python "%~dp0..\server\serve.py"
)
