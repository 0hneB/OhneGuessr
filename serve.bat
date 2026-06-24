@echo off
rem Double-click this to play locally. It serves the folder over http://
rem (browsers block ES modules + fetch over file://), then opens the browser.
cd /d "%~dp0"
echo Serving OhneGuessr at http://localhost:8000
echo Keep this window open while playing. Close it to stop the server.
start "" http://localhost:8000
python -m http.server 8000
