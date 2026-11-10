@echo off
title JurisFlow AI - enviar para o GitHub
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\enviar-github.ps1"
