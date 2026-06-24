@echo off
rem Stops the windowless OhneGuessr server started by serve.bat. serve.py writes
rem its PID to a temp file on start; we kill just that process (not every pythonw).
set "PIDFILE=%TEMP%\ohneguessr-serve.pid"
if not exist "%PIDFILE%" (
  echo No running OhneGuessr server found.
  goto :eof
)
set /p PID=<"%PIDFILE%"
taskkill /pid %PID% /f >nul 2>nul
del "%PIDFILE%" >nul 2>nul
echo Stopped OhneGuessr server ^(pid %PID%^).
