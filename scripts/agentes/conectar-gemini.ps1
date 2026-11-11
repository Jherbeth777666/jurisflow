# Conecta o Google (Gemini) ao OpenCode deste PC e ja dispara os agentes.
# A chave e colada por voce nesta janela e fica guardada so no OpenCode.
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root
$oc = (Get-Command opencode -ErrorAction SilentlyContinue).Source
if (-not $oc) { Write-Host "OpenCode nao encontrado." -ForegroundColor Red; Read-Host "ENTER para fechar"; exit 1 }

Write-Host "=== Conectar Gemini (Google) ao OpenCode ===`n" -ForegroundColor Cyan
Write-Host "1. Vou abrir a pagina para criar a chave. Entre com sua conta Google e clique em 'Create API key'."
Write-Host "2. Copie a chave."
Write-Host "3. Na lista que aparecer aqui, escolha 'Google' (setas + ENTER) e cole a chave (botao direito do mouse cola).`n"
Start-Process 'https://aistudio.google.com/apikey'
Read-Host "Quando tiver copiado a chave, pressione ENTER"
& $oc auth login

$res = Join-Path $root 'docs\agentes\resultados'
New-Item -ItemType Directory -Force -Path $res | Out-Null
$lista = & $oc models google 2>&1 | Out-String
$lista | Set-Content (Join-Path $res 'modelos-google.txt') -Encoding utf8
Write-Host "`nModelos Google disponiveis:" -ForegroundColor Cyan
Write-Host $lista
if ($lista -notmatch 'google/') {
  Write-Host "Nenhum modelo Google apareceu - a conexao nao funcionou. Tente de novo." -ForegroundColor Yellow
  Read-Host "ENTER para fechar"; exit 1
}
Write-Host "Gemini conectado! Disparando os agentes..." -ForegroundColor Green
& (Join-Path $PSScriptRoot 'rodar-agentes.ps1')
