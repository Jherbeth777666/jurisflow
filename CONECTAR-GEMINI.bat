@echo off
title JurisFlow AI - conectar Gemini
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\agentes\conectar-gemini.ps1"
