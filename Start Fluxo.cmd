@echo off
rem Double-click to set up (first time) and open Fluxo on Windows.
if not exist "%~dp0scripts\windows\start.ps1" (
  echo Please extract the ZIP first ^(right-click it, Extract All^), then open "Start Fluxo" from the extracted folder.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\start.ps1"
if errorlevel 1 pause
