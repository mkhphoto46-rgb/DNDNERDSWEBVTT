@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Remote-VTT.ps1"
echo.
echo Remote VTT launcher stopped.
pause
