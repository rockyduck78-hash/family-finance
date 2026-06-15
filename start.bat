@echo off
title Family Finance Tracker
color 0F

set "PATH=%PATH%;C:\Program Files\nodejs"

echo.
echo ============================================
echo    FAMILY FINANCE TRACKER
echo ============================================
echo.
echo Starting server...
echo.

REM Get IP address
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    set "IP=%%a"
    goto :found
)
:found
set "IP=%IP: =%"

echo ============================================
echo.
echo  THIS COMPUTER:
echo     http://localhost:3000
echo.
echo  OTHER DEVICES ON YOUR WIFI:
echo     http://%IP%:3000
echo.
echo ============================================
echo.
echo  Keep this window open!
echo  Press Ctrl+C to stop.
echo.

"C:\Program Files\nodejs\node.exe" "%~dp0server.js"

pause
