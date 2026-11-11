# =============================================================================
# JurisFlow AI - dispara os agentes ARGON (Gemini) e DEEPSEEK no OpenCode
# Usa as autorizacoes que voce ja tem no OpenCode. Cada agente abre numa janela
# propria, le as instrucoes em docs\agentes\ e grava o relatorio em
# docs\agentes\resultados\. Uso: rodar-agentes.ps1 [modelo-gemini] [modelo-deepseek]
# =============================================================================
param([string]$GeminiModel = '', [string]$DeepseekModel = '')
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root
$res = Join-Path $root 'docs\agentes\resultados'
New-Item -ItemType Directory -Force -Path $res | Out-Null
$log = Join-Path $res 'orquestracao.txt'
function Log($m) { $l = "[$(Get-Date -Format 'HH:mm:ss')] $m"; Write-Host $l; Add-Content -Path $log -Value $l -Encoding utf8 }

# --- localizar o OpenCode -------------------------------------------------------
$oc = (Get-Command opencode -ErrorAction SilentlyContinue).Source
if (-not $oc) {
  foreach ($c in @("$env:USERPROFILE\.opencode\bin\opencode.exe", "$env:APPDATA\npm\opencode.cmd", "$env:LOCALAPPDATA\Programs\opencode\opencode.exe")) {
    if (Test-Path $c) { $oc = $c; break }
  }
}
if (-not $oc) {
  $lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'OpenCode.lnk'
  if (Test-Path $lnk) { Log "Atalho OpenCode aponta para: $((New-Object -ComObject WScript.Shell).CreateShortcut($lnk).TargetPath)" }
  Log "ERRO: comando 'opencode' nao encontrado. Instale a CLI: npm i -g opencode-ai"
  Read-Host "ENTER para fechar"; exit 1
}
Log "OpenCode: $oc ($(& $oc --version 2>&1))"

# --- escolher modelos -----------------------------------------------------------
$modelos = & $oc models 2>&1 | ForEach-Object { "$_".Trim() } | Where-Object { $_ -match '^[\w.-]+/[\w.:-]+' }
$modelos | Set-Content (Join-Path $res 'modelos-disponiveis.txt') -Encoding utf8
function Escolher($padroes) { foreach ($p in $padroes) { $m = $modelos | Where-Object { $_ -match $p } | Select-Object -First 1; if ($m) { return ($m -split '\s+')[0] } }; return $null }
if (-not $GeminiModel)   { $GeminiModel   = Escolher @('argon', 'gemini-3.*pro', 'gemini-2\.5-pro', 'gemini.*pro', 'gemini') }
if (-not $DeepseekModel) { $DeepseekModel = Escolher @('deepseek.*(reasoner|r1)', 'deepseek-v3', 'deepseek-chat', 'deepseek') }
Log "Modelo ARGON (Gemini): $GeminiModel"
Log "Modelo DEEPSEEK: $DeepseekModel"

# --- disparar agentes em paralelo -----------------------------------------------
function Disparar($nome, $modelo, $missao) {
  if (-not $modelo) { Log "AVISO: nenhum modelo encontrado para $nome - pulando."; return }
  $saida = Join-Path $res "$nome-saida.txt"
  $msg = "Leia o arquivo $missao e siga integralmente as instrucoes. Grave somente o relatorio indicado nele. Nao altere nenhum outro arquivo."
  $cmd = "Set-Location '$root'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Host 'Agente $nome ($modelo) trabalhando... nao feche esta janela.' -ForegroundColor Cyan; & '$oc' run -m '$modelo' '$msg' 2>&1 | Tee-Object -FilePath '$saida'; Add-Content '$log' ""[`$(Get-Date -Format 'HH:mm:ss')] $nome terminou (codigo `$LASTEXITCODE)""; Write-Host 'Concluido. Pode fechar.' -ForegroundColor Green"
  Start-Process powershell -ArgumentList '-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $cmd
  Log "$nome disparado."
}
Disparar 'ARGON' $GeminiModel 'docs/agentes/ARGON-auditoria.md'
Disparar 'DEEPSEEK' $DeepseekModel 'docs/agentes/DEEPSEEK-analise.md'
Log "Agentes em execucao. Os relatorios aparecerao em docs\agentes\resultados\."
Start-Sleep -Seconds 5
