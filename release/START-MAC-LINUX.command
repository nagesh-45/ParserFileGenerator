#!/bin/sh
cd "$(dirname "$0")" || exit 1

echo "============================================"
echo "  Payment File Creator"
echo "============================================"
echo

if ! command -v java >/dev/null 2>&1; then
    echo "ERROR: Java was not found on this computer."
    echo
    echo "Install Java 17 or newer, then run this file again."
    echo "Download: https://adoptium.net/temurin/releases/"
    echo
    read -r _ 
    exit 1
fi

echo "Starting the application..."
echo "Your browser will open at http://localhost:8080"
echo
echo "Keep this window OPEN while using the app."
echo "Press Ctrl+C in this window to stop it."
echo

( sleep 6; (command -v open >/dev/null 2>&1 && open http://localhost:8080) || (command -v xdg-open >/dev/null 2>&1 && xdg-open http://localhost:8080) ) &

java -jar "payment-file-creator.jar"
