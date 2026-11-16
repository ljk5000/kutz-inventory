@echo off
rem Writes export\inventory.json from KutzInventory's saved file (the game saves it on /reload or logout).
rem Double-click, or use the "Export WoW Inventory" shortcut in the repo folder (pin that one to the taskbar).
title KutzInventory export
cd /d "%~dp0.."

set "NODE=node"
where node >nul 2>nul || set "NODE=C:\Program Files\nodejs\node.exe"

"%NODE%" tools\inventory_export.js %*
if errorlevel 1 (
    echo.
    echo Export FAILED - see the message above.
    pause
    exit /b 1
)
echo.
echo Done. This window closes in 5 seconds.
ping -n 6 127.0.0.1 >nul
