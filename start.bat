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



echo ============================================
echo.
echo  http://localhost:3000
echo.
echo ============================================
echo.
echo  Keep this window open!
echo  Press Ctrl+C to stop.
echo.

"C:\Program Files\nodejs\node.exe" "%~dp0server.js"

pause
