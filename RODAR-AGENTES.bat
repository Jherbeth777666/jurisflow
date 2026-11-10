@echo off
title JurisFlow AI - agentes
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\agentes\rodar-agentes.ps1" %*
