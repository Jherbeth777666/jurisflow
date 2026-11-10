@echo off
title JurisFlow AI - configurar IA
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\configurar-ia.ps1"
