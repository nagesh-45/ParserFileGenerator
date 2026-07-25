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

echo Starting the application...
echo Your browser will open at http://localhost:8080
echo.
echo Keep this window OPEN while using the app.
echo Press Ctrl+C in this window to stop it.
echo.

start "" http://localhost:8080
java -jar "payment-file-creator.jar"

echo.
echo The application has stopped.
pause
