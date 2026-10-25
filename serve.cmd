@echo off
rem Double-click to serve this folder at http://localhost:5173/
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %*
