# Para o Supabase local (os dados ficam salvos no Docker).
Set-Location (Split-Path -Parent $PSScriptRoot)
npx --yes supabase@latest stop
Write-Host "Supabase local parado. Dados preservados." -ForegroundColor Green
Read-Host "Pressione ENTER para fechar"
