# =============================================================================
# JurisFlow AI - inicializacao LOCAL no Windows (desenvolvimento/demonstracao)
#   1. Verifica Node.js e Docker Desktop (abre o Docker se estiver fechado)
#   2. Instala dependencias (npm install) na primeira vez
#   3. Sobe o Supabase local (banco + autenticacao) e aplica as migrations
#   4. Cria o usuario/escritorio de DEMONSTRACAO com dados ficticios
#   5. Gera o .env.local e abre o site no navegador
# =============================================================================
$ErrorActionPreference = 'Continue'  # erros de comandos nativos sao tratados via $LASTEXITCODE
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Passo($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Falha($msg) {
  Write-Host "`n[ERRO] $msg" -ForegroundColor Red
  Read-Host "`nPressione ENTER para fechar"
  exit 1
}

Write-Host "JurisFlow AI - ambiente local" -ForegroundColor White

# --- 1. Node.js --------------------------------------------------------------
Passo "Verificando Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Falha "Node.js nao encontrado. Instale a versao LTS em https://nodejs.org e rode novamente." }
$ver = (node -v).TrimStart('v').Split('.')
if ([int]$ver[0] -lt 20 -or ([int]$ver[0] -eq 20 -and [int]$ver[1] -lt 19)) {
  Falha "Node.js $(node -v) e antigo. Instale a versao LTS (20.19+ ou 22+) em https://nodejs.org."
}
Write-Host "Node.js $(node -v) ok"

# --- 2. Docker Desktop ---------------------------------------------------------
Passo "Verificando Docker Desktop"
foreach ($d in @("$env:ProgramFiles\Docker\Docker\resources\bin", "$env:LOCALAPPDATA\Programs\Docker\Docker\resources\bin")) {
  if ((Test-Path $d) -and ($env:Path -notlike "*$d*")) { $env:Path = "$d;$env:Path" }
}
$dockerOk = $false
try { docker info *> $null; $dockerOk = ($LASTEXITCODE -eq 0) } catch { $dockerOk = $false }
if (-not $dockerOk) {
  # Procura o Docker Desktop em locais comuns e nos atalhos (instalacoes fora do padrao)
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
  if (-not $exe) { Falha "Docker Desktop nao encontrado. Abra o Docker Desktop manualmente, espere ficar 'Running' e rode novamente." }
  $bin = Join-Path (Split-Path $exe) 'resources\bin'
  if (Test-Path $bin) { $env:Path = "$bin;$env:Path" }
  Write-Host "Abrindo o Docker Desktop (pode levar 1-2 minutos)..."
  Start-Process $exe
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 3
    try { docker info *> $null; if ($LASTEXITCODE -eq 0) { $dockerOk = $true; break } } catch {}
    Write-Host -NoNewline "."
  }
  Write-Host ""
  if (-not $dockerOk) { Falha "O Docker nao respondeu. Abra o Docker Desktop, espere ficar 'Running' e rode novamente." }
}
Write-Host "Docker ok"

# --- 3. Dependencias -------------------------------------------------------------
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  Passo "Instalando dependencias (primeira vez, alguns minutos)"
  npm install --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) { Falha "npm install falhou." }
}

# --- 4. Supabase local -------------------------------------------------------------
Passo "Iniciando o Supabase local (na primeira vez baixa as imagens do Docker, ~5-10 min)"
npx --yes supabase@latest start
if ($LASTEXITCODE -ne 0) { Falha "Nao foi possivel iniciar o Supabase local. Veja a mensagem acima." }

Passo "Aplicando migrations do banco"
npx --yes supabase@latest migration up --local --include-all
if ($LASTEXITCODE -ne 0) { Falha "Falha ao aplicar as migrations. Veja a mensagem acima." }

$status = npx --yes supabase@latest status -o env 2>$null
$vars = @{}
foreach ($line in $status) {
  if ($line -match '^\s*([A-Z_]+)="?([^"]*)"?\s*$') { $vars[$Matches[1]] = $Matches[2] }
}
$apiUrl = $vars['API_URL']
$anon = $vars['ANON_KEY']
if (-not $anon) { $anon = $vars['PUBLISHABLE_KEY'] }
if (-not $apiUrl -or -not $anon) { Falha "Nao consegui ler URL/chave do Supabase local (supabase status)." }

$envFile = Join-Path $root '.env.local'
@(
  "# Gerado por scripts/iniciar.ps1 - Supabase LOCAL",
  "# A API local e servida pelo proxy do Vite (mesmo endereco do site)",
  "VITE_SUPABASE_URL=http://localhost:5173/supabase",
  "VITE_SUPABASE_ANON_KEY=$anon"
) | Set-Content -Path $envFile -Encoding ascii
$env:SUPABASE_LOCAL_URL = $apiUrl
Write-Host ".env.local atualizado (API local $apiUrl via proxy do site)"

# --- 5. Dados de demonstracao ---------------------------------------------------------
Passo "Preparando escritorio de demonstracao"
$db = docker ps --format '{{.Names}}' | Where-Object { $_ -like 'supabase_db_jurisflow*' } | Select-Object -First 1
if (-not $db) { Falha "Container do banco nao encontrado." }
docker cp (Join-Path $root 'supabase\local\demo_local.sql') "${db}:/tmp/demo_local.sql" | Out-Null
docker exec $db psql -q -U postgres -d postgres -f /tmp/demo_local.sql
if ($LASTEXITCODE -ne 0) { Write-Host "[aviso] Nao foi possivel carregar a demonstracao; o sistema funciona mesmo assim." -ForegroundColor Yellow }

# --- 6. Funcoes de IA (opcional) -------------------------------------------------------
$fnEnv = Join-Path $root 'supabase\functions\.env'
if (Test-Path $fnEnv) {
  Passo "Iniciando funcoes de IA (janela separada)"
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root'; npx --yes supabase@latest functions serve --env-file supabase/functions/.env"
} else {
  Write-Host "`n[info] Assistente IA desligado. Para ligar: copie supabase\functions\.env.example para .env, coloque sua chave e rode este script de novo." -ForegroundColor Yellow
}

# --- 7. Site --------------------------------------------------------------------------
Passo "Abrindo o JurisFlow AI"
Write-Host ""
Write-Host "  Site:        http://localhost:5173" -ForegroundColor Green
Write-Host "  Login demo:  demo@jurisflow.local" -ForegroundColor Green
Write-Host "  Senha demo:  Demo@2026" -ForegroundColor Green
Write-Host "  Banco (Studio): http://localhost:54323" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Mantenha esta janela aberta enquanto usa o sistema. Para parar: feche-a e rode PARAR-JURISFLOW.bat" -ForegroundColor DarkGray
# Se ja houver um servidor do site rodando (de uma execucao anterior), encerra-o para
# que a nova configuracao (.env.local) seja carregada.
$pids = netstat -ano | Select-String ':5173\s+\S+\s+LISTENING\s+(\d+)' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Sort-Object -Unique
foreach ($p in $pids) {
  $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -eq 'node') {
    Write-Host "Reiniciando o servidor do site (processo $p)..." -ForegroundColor DarkGray
    Stop-Process -Id $p -Force
  }
}
Start-Sleep -Seconds 1
Start-Job { Start-Sleep -Seconds 4; Start-Process 'http://localhost:5173' } | Out-Null
npm run dev -- --port 5173 --strictPort
