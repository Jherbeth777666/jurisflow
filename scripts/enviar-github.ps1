# =============================================================================
# JurisFlow AI - enviar o codigo para um repositorio PRIVADO no GitHub
# Na primeira vez o Git abre o navegador para voce entrar no GitHub.
# Depois, rode de novo sempre que quiser enviar alteracoes.
# =============================================================================
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
function Falha($m) { Write-Host "`n[ERRO] $m" -ForegroundColor Red; Read-Host "ENTER para fechar"; exit 1 }

Write-Host "JurisFlow AI - enviar para o GitHub`n" -ForegroundColor White
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Falha "Git nao encontrado. Instale em https://git-scm.com/download/win (opcoes padrao) e rode novamente."
}

# Identidade do autor dos commits
if (-not (git config user.email)) {
  $nome = Read-Host "Seu nome (para o historico do Git)"
  $mail = Read-Host "Seu e-mail do GitHub"
  git config user.name "$nome"
  git config user.email "$mail"
}

if (-not (Test-Path (Join-Path $root '.git'))) { git init -q }
git branch -M main 2>$null

# Garante que segredos e arquivos locais NUNCA sejam enviados
$ignorar = @('node_modules', 'dist', '.env', '.env.local', '.env.*.local', 'supabase/functions/.env', 'supabase/.temp', 'supabase/.branches', '.netlify')
$gi = Join-Path $root '.gitignore'
$atual = if (Test-Path $gi) { Get-Content $gi } else { @() }
foreach ($i in $ignorar) { if ($atual -notcontains $i) { Add-Content $gi $i } }
foreach ($f in '.env.local', 'supabase/functions/.env', '.env') { git rm --cached -q --ignore-unmatch $f 2>$null }

git add -A
$segredos = git diff --cached --name-only | Where-Object { $_ -match '(^|/)\.env($|\.local$)' }
if ($segredos) { Falha "Arquivo de segredo preparado para envio: $segredos. Envio cancelado." }
git commit -q -m "Atualizacao do JurisFlow AI ($(Get-Date -Format 'dd/MM/yyyy HH:mm'))" 2>$null
if ($LASTEXITCODE -ne 0) { Write-Host "Nada novo para registrar; enviando o que ja existe." -ForegroundColor DarkGray }

$remoto = git remote get-url origin 2>$null
if (-not $remoto) {
  Write-Host "`nCrie um repositorio PRIVADO e VAZIO em https://github.com/new"
  Write-Host "  - Nome sugerido: jurisflow-ai"
  Write-Host "  - Marque 'Private'"
  Write-Host "  - NAO marque README, .gitignore nem licenca"
  Start-Process 'https://github.com/new'
  $remoto = Read-Host "`nCole o endereco do repositorio (ex.: https://github.com/seu-usuario/jurisflow-ai.git)"
  if ($remoto -notmatch '^https://github\.com/[^/]+/[^/]+?(\.git)?$') { Falha "Endereco invalido." }
  git remote add origin $remoto
}

# Se o GitHub ja tiver commits que nao estao aqui (ex.: enviados pelo Claude),
# os arquivos DESTA pasta viram a nova versao, mantendo o historico do GitHub.
git fetch -q origin main 2>$null
if ($LASTEXITCODE -eq 0) {
  git merge-base --is-ancestor origin/main HEAD 2>$null
  if ($LASTEXITCODE -ne 0) {
    git reset -q --soft origin/main
    git add -A
    git commit -q -m "Atualizacao do JurisFlow AI ($(Get-Date -Format 'dd/MM/yyyy HH:mm'))" 2>$null
  }
}

Write-Host "`nEnviando para $remoto (na primeira vez o navegador abre para login no GitHub)..." -ForegroundColor Cyan
git push -u origin main
if ($LASTEXITCODE -ne 0) { Falha "O envio falhou. Confira se o repositorio existe, esta vazio e se voce entrou na conta certa." }

Write-Host "`nCodigo enviado com sucesso." -ForegroundColor Green
Write-Host "`nProximo passo - ligar o Netlify ao GitHub:"
Write-Host "  1. https://app.netlify.com > Add new site > Import an existing project > GitHub > jurisflow-ai"
Write-Host "  2. Build command: npm run build    Publish directory: dist   (ja vem do netlify.toml)"
Write-Host "  3. Em 'Environment variables' adicione VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY do seu projeto Supabase"
Write-Host "  4. Deploy. A partir dai, cada envio ao GitHub atualiza o site sozinho."
Read-Host "`nENTER para fechar"
