@echo off
rem Stops the server started by serve.bat, using the PID serve.py wrote on start.
set "PIDFILE=%TEMP%\ohneguessr-serve.pid"
if not exist "%PIDFILE%" (
  echo No running OhneGuessr server found.
  goto :eof
)
set /p PID=<"%PIDFILE%"
taskkill /pid %PID% /f >nul 2>nul
del "%PIDFILE%" >nul 2>nul
echo Stopped OhneGuessr server ^(pid %PID%^).
