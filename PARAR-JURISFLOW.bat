@echo off
title JurisFlow AI - parar
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\parar.ps1"
