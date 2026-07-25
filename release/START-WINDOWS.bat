@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   Payment File Creator
echo ============================================
echo.

java -version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Java was not found on this computer.
    echo.
    echo Install Java 17 or newer, then run this file again.
    echo Download: https://adoptium.net/temurin/releases/
    echo.
    pause
    exit /b 1
)

REM Run from a temp copy so Windows never locks the tracked jar and "git pull" stays clean.
set "RUNDIR=%TEMP%\payment-file-creator"
if not exist "%RUNDIR%" mkdir "%RUNDIR%"
copy /Y "payment-file-creator.jar" "%RUNDIR%\payment-file-creator.jar" >nul
if errorlevel 1 (
    echo Could not copy to temp, running directly instead.
    set "RUNJAR=payment-file-creator.jar"
) else (
    set "RUNJAR=%RUNDIR%\payment-file-creator.jar"
)

echo Starting the application...
echo Your browser will open at http://localhost:8080
echo.
echo Keep this window OPEN while using the app.
echo Press Ctrl+C in this window to stop it.
echo.

start "" http://localhost:8080
java -jar "%RUNJAR%"

echo.
echo The application has stopped.
pause
