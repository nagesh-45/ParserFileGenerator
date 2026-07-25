@echo off
setlocal EnableExtensions
cd /d "%~dp0\.."

echo ============================================
echo   FORCE UPDATE + RUN  (build 2026-07-25g)
echo ============================================
echo.
echo This kills EVERY java process, refreshes git,
echo deletes the TEMP jar, and starts a clean copy.
echo.

REM Kill all Java - required so the TEMP jar unlocks
taskkill /F /IM java.exe >nul 2>&1
timeout /t 2 /nobreak >nul

where git >nul 2>&1
if errorlevel 1 (
    echo ERROR: git not found. Install Git for Windows first.
    pause
    exit /b 1
)

echo Fetching latest code...
git fetch origin
git reset --hard origin/main
if errorlevel 1 (
    echo ERROR: git reset failed. Are you inside the ParserFileGenerator repo?
    pause
    exit /b 1
)

if not exist "release\payment-file-creator.jar" (
    echo ERROR: release\payment-file-creator.jar missing after pull.
    pause
    exit /b 1
)

REM Prove the jar contains this build
findstr /C:"2026-07-25g" "release\payment-file-creator.jar" >nul
if errorlevel 1 (
    echo WARNING: jar may not contain build 2026-07-25g yet.
    echo          Continuing anyway — check http://localhost:8080/version after start.
) else (
    echo OK: release jar contains build stamp 2026-07-25g
)

REM Wipe TEMP copy so Windows cannot run a stale jar
rd /s /q "%TEMP%\payment-file-creator" >nul 2>&1
mkdir "%TEMP%\payment-file-creator" >nul 2>&1
copy /Y "release\payment-file-creator.jar" "%TEMP%\payment-file-creator\payment-file-creator.jar" >nul
if errorlevel 1 (
    echo ERROR: could not copy jar to TEMP.
    pause
    exit /b 1
)

echo.
echo Starting fresh app...
echo After browser opens, VERIFY:
echo   1) Page shows: build 2026-07-25g
echo   2) http://localhost:8080/version shows {"buildId":"2026-07-25g"}
echo   3) After upload: Document children: 1 (FIToFICstmrCdtTrf)
echo.
echo Keep this window OPEN. Press Ctrl+C to stop.
echo.

start "" http://localhost:8080/version
timeout /t 1 /nobreak >nul
start "" http://localhost:8080/
java -jar "%TEMP%\payment-file-creator\payment-file-creator.jar"

echo.
echo App stopped.
pause
