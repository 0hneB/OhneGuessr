@echo off
rem Double-click this to play locally. It serves the folder over http://
rem (browsers block ES modules + fetch over file://), opens your browser, and
rem lets maps you upload in Settings be saved as real files under data\.
rem
rem Runs windowless via pythonw, so no console window stays open. Use stop.bat
rem to stop the server (or close it from Task Manager).
cd /d "%~dp0"
where pythonw >nul 2>nul
if %errorlevel%==0 (
  start "" pythonw "%~dp0serve.py"
) else (
  start "" /min python "%~dp0serve.py"
)
