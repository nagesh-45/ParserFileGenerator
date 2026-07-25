@echo off
setlocal EnableExtensions
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

REM Stop any previous instance still bound to port 8080 (stale TEMP jar is a common cause).
echo Stopping any previous app instance on port 8080...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING"') do (
    echo   Killing PID %%P
    taskkill /F /PID %%P >nul 2>&1
)
REM Also stop leftover java processes started from this app name (best-effort).
wmic process where "CommandLine like '%%payment-file-creator.jar%%'" call terminate >nul 2>&1

timeout /t 2 /nobreak >nul

REM Always refresh the TEMP copy from the tracked release jar.
set "RUNDIR=%TEMP%\payment-file-creator"
if not exist "%RUNDIR%" mkdir "%RUNDIR%"
del /F /Q "%RUNDIR%\payment-file-creator.jar" >nul 2>&1
copy /Y "payment-file-creator.jar" "%RUNDIR%\payment-file-creator.jar" >nul
if errorlevel 1 (
    echo WARNING: Could not refresh TEMP jar — running release\payment-file-creator.jar directly.
    set "RUNJAR=payment-file-creator.jar"
) else (
    set "RUNJAR=%RUNDIR%\payment-file-creator.jar"
    echo Using refreshed jar: %RUNJAR%
)

echo.
echo Starting the application...
echo Your browser will open at http://localhost:8080
echo After it opens, confirm the page shows: build 2026-07-25g
echo If upload succeeds you should also see Document children: 1 (FIToFICstmrCdtTrf).
echo.
echo Keep this window OPEN while using the app.
echo Press Ctrl+C in this window to stop it.
echo.

start "" http://localhost:8080/
java -jar "%RUNJAR%"

echo.
echo The application has stopped.
pause
