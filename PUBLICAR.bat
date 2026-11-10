@echo off
title JurisFlow AI - publicar
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\publicar.ps1"
