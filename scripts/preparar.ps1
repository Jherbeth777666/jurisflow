# =============================================================================
# JurisFlow AI - prepara o ambiente LOCAL sem nenhuma interacao (idempotente)
#   1. Verifica Node.js e Docker Desktop (abre o Docker se estiver fechado)
#   2. Instala dependencias na primeira vez
#   3. Sobe o Supabase local e aplica as migrations
#   4. Gera o .env.local e carrega o escritorio de DEMONSTRACAO
#   5. Sobe as funcoes de IA em segundo plano, se houver supabase\functions\.env
# Usado por `npm run local` (painel do Claude) e por scripts/iniciar.ps1.
# Sai com codigo 1 em caso de erro; nunca espera ENTER.
# =============================================================================
$ErrorActionPreference = 'Continue'  # erros de comandos nativos sao tratados via $LASTEXITCODE
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$porta = 5173

function Passo($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Falha($msg) { Write-Host "`n[ERRO] $msg" -ForegroundColor Red; exit 1 }

# --- 1. Node.js --------------------------------------------------------------
Passo "Verificando Node.js"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Falha "Node.js nao encontrado. Instale a versao LTS em https://nodejs.org." }
$ver = (node -v).TrimStart('v').Split('.')
if ([int]$ver[0] -lt 20 -or ([int]$ver[0] -eq 20 -and [int]$ver[1] -lt 19)) { Falha "Node.js $(node -v) e antigo (precisa 20.19+ ou 22+)." }
Write-Host "Node.js $(node -v) ok"

# --- 2. Docker Desktop ---------------------------------------------------------
Passo "Verificando Docker Desktop"
foreach ($d in @("$env:ProgramFiles\Docker\Docker\resources\bin", "$env:LOCALAPPDATA\Programs\Docker\Docker\resources\bin")) {
  if ((Test-Path $d) -and ($env:Path -notlike "*$d*")) { $env:Path = "$d;$env:Path" }
}
$dockerOk = $false
try { docker info *> $null; $dockerOk = ($LASTEXITCODE -eq 0) } catch { $dockerOk = $false }
if (-not $dockerOk) {
  $cands = @(
    (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'),
    (Join-Path $env:ProgramW6432 'Docker\Docker\Docker Desktop.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Docker\Docker\Docker Desktop.exe'),
    (Join-Path $env:LOCALAPPDATA 'Docker\Docker Desktop.exe')
  )
  $sh = New-Object -ComObject WScript.Shell
  $lnks = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Docker Desktop.lnk'),
    (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Docker Desktop.lnk'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Docker Desktop.lnk')
  )
  foreach ($l in $lnks) { if ($l -and (Test-Path $l)) { $cands += $sh.CreateShortcut($l).TargetPath } }
  $exe = $cands | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  if (-not $exe) { Falha "Docker Desktop nao encontrado. Abra-o manualmente e tente de novo." }
  $bin = Join-Path (Split-Path $exe) 'resources\bin'
  if (Test-Path $bin) { $env:Path = "$bin;$env:Path" }
  Write-Host "Abrindo o Docker Desktop (pode levar 1-2 minutos)..."
  Start-Process $exe -WindowStyle Minimized
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 3
    try { docker info *> $null; if ($LASTEXITCODE -eq 0) { $dockerOk = $true; break } } catch {}
  }
  if (-not $dockerOk) { Falha "O Docker nao respondeu em 4 minutos." }
}
Write-Host "Docker ok"

# --- 3. Dependencias -------------------------------------------------------------
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  Passo "Instalando dependencias (primeira vez)"
  npm install --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) { Falha "npm install falhou." }
}

# --- 4. Supabase local -------------------------------------------------------------
Passo "Iniciando o Supabase local"
npx --yes supabase@latest start
if ($LASTEXITCODE -ne 0) { Falha "Nao foi possivel iniciar o Supabase local." }

Passo "Aplicando migrations do banco"
npx --yes supabase@latest migration up --local --include-all
if ($LASTEXITCODE -ne 0) { Falha "Falha ao aplicar as migrations." }

$status = npx --yes supabase@latest status -o env 2>$null
$vars = @{}
foreach ($line in $status) {
  if ($line -match '^\s*([A-Z_]+)="?([^"]*)"?\s*$') { $vars[$Matches[1]] = $Matches[2] }
}
$anon = $vars['ANON_KEY']
if (-not $anon) { $anon = $vars['PUBLISHABLE_KEY'] }
if (-not $vars['API_URL'] -or -not $anon) { Falha "Nao consegui ler URL/chave do Supabase local (supabase status)." }

@(
  "# Gerado por scripts/preparar.ps1 - Supabase LOCAL",
  "# A API local e servida pelo proxy do Vite (mesmo endereco do site)",
  "VITE_SUPABASE_URL=http://localhost:$porta/supabase",
  "VITE_SUPABASE_ANON_KEY=$anon"
) | Set-Content -Path (Join-Path $root '.env.local') -Encoding ascii
Write-Host ".env.local atualizado (API local $($vars['API_URL']) via proxy do site)"

Passo "Preparando escritorio de demonstracao"
$db = docker ps --format '{{.Names}}' | Where-Object { $_ -like 'supabase_db_jurisflow*' } | Select-Object -First 1
if (-not $db) { Falha "Container do banco nao encontrado." }
docker cp (Join-Path $root 'supabase\local\demo_local.sql') "${db}:/tmp/demo_local.sql" | Out-Null
docker exec $db psql -q -U postgres -d postgres -f /tmp/demo_local.sql
if ($LASTEXITCODE -ne 0) { Write-Host "[aviso] Demonstracao nao carregada; o sistema funciona mesmo assim." -ForegroundColor Yellow }

# --- 5. Funcoes de IA (opcional) -------------------------------------------------------
if (Test-Path (Join-Path $root 'supabase\functions\.env')) {
  $rodando = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'functions serve' -and $_.CommandLine -match [regex]::Escape($root) }
  if (-not $rodando) {
    Passo "Iniciando funcoes de IA em segundo plano"
    New-Item -ItemType Directory -Force (Join-Path $root '.ai_workspace') | Out-Null
    Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoProfile", "-Command", "Set-Location '$root'; npx --yes supabase@latest functions serve --env-file supabase/functions/.env *> '$root\.ai_workspace\functions.log'"
  }
} else {
  Write-Host "[info] Assistente IA desligado (falta supabase\functions\.env)." -ForegroundColor Yellow
}

Write-Host "`nAmbiente pronto. Login demo: demo@jurisflow.local / Demo@2026 - Studio: http://localhost:54323" -ForegroundColor Green
exit 0
