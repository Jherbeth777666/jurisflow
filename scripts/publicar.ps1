# =============================================================================
# JurisFlow AI - PUBLICAR na internet (Supabase na nuvem + Netlify)
# Voce faz login nas suas contas pelo navegador; senhas e chaves sao digitadas
# por voce nesta janela. Pode ser executado de novo para atualizar o site.
# =============================================================================
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
function Passo($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Falha($m) { Write-Host "`n[ERRO] $m" -ForegroundColor Red; Read-Host "ENTER para fechar"; exit 1 }
$sb = @('--yes', 'supabase@latest')

Write-Host "JurisFlow AI - publicacao`n" -ForegroundColor White
Write-Host "Antes de continuar:"
Write-Host "  1. Crie um projeto em https://supabase.com/dashboard (regiao Sao Paulo) e guarde a senha do banco."
Write-Host "  2. Tenha uma conta em https://app.netlify.com (pode entrar com o GitHub/Google)."
Read-Host "`nPressione ENTER quando estiver pronto"

# --- Supabase ------------------------------------------------------------------
Passo "Login no Supabase (abre o navegador)"
npx @sb login
if ($LASTEXITCODE -ne 0) { Falha "Login no Supabase falhou." }

Passo "Seus projetos no Supabase"
npx @sb projects list
$ref = Read-Host "`nCole o REFERENCE ID do projeto do JurisFlow"
if ($ref -notmatch '^[a-z0-9]{20}$') { Falha "Reference ID invalido (20 letras/numeros)." }

Passo "Vinculando o projeto (vai pedir a senha do banco)"
npx @sb link --project-ref $ref
if ($LASTEXITCODE -ne 0) { Falha "Nao foi possivel vincular o projeto." }

Passo "Criando as tabelas e regras de seguranca no banco (migrations)"
npx @sb db push
if ($LASTEXITCODE -ne 0) { Falha "Falha ao aplicar as migrations." }

$keys = npx @sb projects api-keys --project-ref $ref -o env 2>$null
$anon = $null
foreach ($l in $keys) { if ($l -match '^\s*(ANON_KEY|SUPABASE_ANON_KEY|anon)\s*=\s*"?([^"]+)"?') { $anon = $Matches[2] } }
if (-not $anon) {
  Write-Host "Nao consegui ler a chave 'anon' automaticamente." -ForegroundColor Yellow
  Write-Host "Copie em: Supabase > Project Settings > API Keys > anon public"
  $anon = Read-Host "Cole a chave anon (publica)"
}
$apiUrl = "https://$ref.supabase.co"

# --- Build ---------------------------------------------------------------------
Passo "Gerando a versao de producao do site"
$env:VITE_SUPABASE_URL = $apiUrl
$env:VITE_SUPABASE_ANON_KEY = $anon
npm run build
if ($LASTEXITCODE -ne 0) { Falha "O build falhou." }

# --- Netlify -------------------------------------------------------------------
Passo "Login no Netlify (abre o navegador)"
npx --yes netlify-cli@latest login
if ($LASTEXITCODE -ne 0) { Falha "Login no Netlify falhou." }

if (-not (Test-Path (Join-Path $root '.netlify\state.json'))) {
  Passo "Criando o site no Netlify (escolha sua equipe e um nome, ex.: jurisflow-seuescritorio)"
  npx --yes netlify-cli@latest sites:create
  if ($LASTEXITCODE -ne 0) { Falha "Nao foi possivel criar o site no Netlify." }
}
npx --yes netlify-cli@latest env:set VITE_SUPABASE_URL $apiUrl | Out-Null
npx --yes netlify-cli@latest env:set VITE_SUPABASE_ANON_KEY $anon | Out-Null

Passo "Publicando o site"
$out = npx --yes netlify-cli@latest deploy --prod --dir dist --no-build --json
if ($LASTEXITCODE -ne 0) { Falha "Falha ao publicar no Netlify." }
$siteUrl = $null
try { $siteUrl = (($out -join "`n") | ConvertFrom-Json).url } catch {}
if (-not $siteUrl) { $siteUrl = Read-Host "Cole o endereco do site mostrado acima (https://...netlify.app)" }

# --- Funcoes de IA -------------------------------------------------------------
Passo "Publicando as funcoes de IA"
$fnEnv = Join-Path $root 'supabase\functions\.env'
if (Test-Path $fnEnv) {
  $tmp = Join-Path $env:TEMP 'jurisflow-secrets.env'
  (Get-Content $fnEnv | Where-Object { $_ -notmatch '^\s*(#|ALLOWED_ORIGINS=)' }) + "ALLOWED_ORIGINS=$siteUrl" | Set-Content $tmp -Encoding ascii
  npx @sb secrets set --env-file $tmp --project-ref $ref
  Remove-Item $tmp -Force
} else {
  Write-Host "[info] Sem chave de IA configurada (rode CONFIGURAR-IA.bat antes, se quiser o assistente)." -ForegroundColor Yellow
  npx @sb secrets set "ALLOWED_ORIGINS=$siteUrl" --project-ref $ref
}
foreach ($f in 'ai-assistant', 'ai-import', 'ai-compose') {
  npx @sb functions deploy $f --project-ref $ref
}

Write-Host "`n================================================================" -ForegroundColor Green
Write-Host " Publicado: $siteUrl" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host "`nUltimo ajuste (1 minuto) no painel do Supabase:"
Write-Host "  Authentication > URL Configuration"
Write-Host "    Site URL:       $siteUrl"
Write-Host "    Redirect URLs:  $siteUrl/redefinir-senha"
Write-Host "  Authentication > Sign In / Providers > Email: deixe 'Confirm email' LIGADO."
Write-Host "`nDepois e so acessar o site, criar a conta e o escritorio."
Start-Process $siteUrl
Read-Host "`nENTER para fechar"
