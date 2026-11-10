# =============================================================================
# JurisFlow AI - liga o Assistente IA no ambiente LOCAL
# Pede o provedor e a chave (digitada por voce, nao aparece na tela), grava em
# supabase\functions\.env (fora do Git) e inicia as funcoes de IA.
# =============================================================================
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "JurisFlow AI - configurar Assistente IA`n" -ForegroundColor White
Write-Host "Provedores:"
Write-Host "  1) Gemini (Google)  - tem plano gratuito: https://aistudio.google.com/apikey"
Write-Host "  2) DeepSeek         - muito barato:       https://platform.deepseek.com/api_keys"
Write-Host "  3) Groq             - rapido, gratuito:   https://console.groq.com/keys"
Write-Host "  4) Anthropic (Claude)                     https://console.anthropic.com"
$op = Read-Host "`nEscolha (1-4) [1]"
if (-not $op) { $op = '1' }
$map = @{ '1' = @('gemini','GEMINI_API_KEY'); '2' = @('deepseek','DEEPSEEK_API_KEY'); '3' = @('groq','GROQ_API_KEY'); '4' = @('anthropic','ANTHROPIC_API_KEY') }
if (-not $map.ContainsKey($op)) { Write-Host "Opcao invalida." -ForegroundColor Red; Read-Host "ENTER para fechar"; exit 1 }
$prov, $var = $map[$op]

$sec = Read-Host "Cole a chave de API do $prov (nao aparece na tela)" -AsSecureString
$key = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
if (-not $key -or $key.Length -lt 10) { Write-Host "Chave vazia ou invalida." -ForegroundColor Red; Read-Host "ENTER para fechar"; exit 1 }

$linhas = @(
  "# Gerado por scripts/configurar-ia.ps1 - NAO versionar",
  "AI_PROVIDER=$prov",
  "$var=$key",
  "ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173"
)
$reserva = Read-Host "`nQuer configurar um provedor RESERVA (usado se o principal falhar)? (s/N)"
if ($reserva -match '^[sS]') {
  $op2 = Read-Host "Reserva (1-4)"
  if ($map.ContainsKey($op2) -and $op2 -ne $op) {
    $prov2, $var2 = $map[$op2]
    $sec2 = Read-Host "Cole a chave do $prov2 (nao aparece na tela)" -AsSecureString
    $key2 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec2))
    if ($key2) { $linhas += "AI_FALLBACK_PROVIDER=$prov2"; $linhas += "$var2=$key2" }
  }
}
$envPath = Join-Path $root 'supabase\functions\.env'
$linhas | Set-Content -Path $envPath -Encoding ascii
Remove-Variable key, key2 -ErrorAction SilentlyContinue
Write-Host "`nConfiguracao salva em supabase\functions\.env" -ForegroundColor Green

Write-Host "`nIniciando as funcoes de IA (deixe esta janela aberta)..." -ForegroundColor Cyan
npx --yes supabase@latest functions serve --env-file supabase/functions/.env
Read-Host "ENTER para fechar"
