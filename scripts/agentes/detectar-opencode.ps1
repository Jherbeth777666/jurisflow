# Descobre o OpenCode e os modelos configurados (nao le nem grava credenciais).
$out = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'docs\agentes\resultados\opencode-ambiente.txt'
$r = @()
$cmd = Get-Command opencode -ErrorAction SilentlyContinue
$r += "opencode no PATH: $($cmd.Source)"
if (-not $cmd) {
  foreach ($c in @("$env:USERPROFILE\.opencode\bin\opencode.exe", "$env:LOCALAPPDATA\Programs\opencode\opencode.exe", "$env:APPDATA\npm\opencode.cmd", "$env:USERPROFILE\AppData\Roaming\npm\opencode.cmd")) {
    if (Test-Path $c) { $r += "encontrado: $c"; $cmd = $c; break }
  }
  $lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'OpenCode.lnk'
  if (Test-Path $lnk) { $r += "atalho aponta para: $((New-Object -ComObject WScript.Shell).CreateShortcut($lnk).TargetPath)" }
}
if ($cmd) {
  $exe = if ($cmd -is [string]) { $cmd } else { $cmd.Source }
  $r += "versao: $(& $exe --version 2>&1)"
  $r += "--- modelos ---"
  $r += (& $exe models 2>&1 | Out-String)
}
$r | Set-Content -Path $out -Encoding utf8
