@echo off
echo Starting Blue Chip Stock Tracker...
echo.

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH.
    echo Please install Python 3.9+ from https://python.org
    pause
    exit /b 1
)

REM Install Python dependencies if needed
echo Checking Python dependencies...
python -m pip install fastapi uvicorn yfinance pandas --quiet

REM Check if Node.js is available
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed or not in PATH.
    echo Please install Node.js 18+ from https://nodejs.org
    pause
    exit /b 1
)

REM Install npm dependencies if needed
if not exist "node_modules" (
    echo Installing npm dependencies...
    npm install
)

REM Build if dist doesn't exist
if not exist "dist" (
    echo Building app...
    npm run build
)

REM Start the app
echo Launching app...
npx electron .
