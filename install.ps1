# CraftLauncher — instalador Windows em um comando (rode no PowerShell):
#   irm https://raw.githubusercontent.com/contasuportedis-png/CraftLauncher/main/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$Repo = 'contasuportedis-png/CraftLauncher'

Write-Host '⛏️  Instalando CraftLauncher...' -ForegroundColor Green

function Get-JavaMajor {
  try {
    $out = & java -version 2>&1 | Out-String
    if ($out -match '"(\d+)\.') { return [int]$Matches[1] }
  } catch {}
  return 0
}

if ((Get-JavaMajor) -lt 17) {
  Write-Host '☕ Java 17+ não encontrado. Baixando Eclipse Temurin 21 (JRE)...' -ForegroundColor Yellow
  $msi = "$env:TEMP\temurin-21-jre.msi"
  Invoke-WebRequest -Uri 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse' -OutFile $msi
  Write-Host 'Instalando Java (pode pedir confirmação do Windows)...'
  $p = Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /quiet /norestart" -Wait -PassThru
  Remove-Item $msi -ErrorAction SilentlyContinue
  if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
    Write-Host '❌ Instalação automática do Java falhou. Instale manualmente em https://adoptium.net (versão 21) e rode este comando de novo.' -ForegroundColor Red
    exit 1
  }
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
  if ((Get-JavaMajor) -lt 17) {
    Write-Host '❌ Java ainda não detectado. Feche e reabra o PowerShell e rode de novo (ou instale em https://adoptium.net).' -ForegroundColor Red
    exit 1
  }
}
Write-Host ("☕ " + ((& java -version 2>&1 | Out-String).Split("`n")[0].Trim()))

Write-Host '🔎 Localizando última versão...'
$rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest"
$asset = $rel.assets | Where-Object { $_.name -like '*Setup*.exe' } | Select-Object -First 1
if (-not $asset) { Write-Host '❌ Instalador .exe não encontrado na release.' -ForegroundColor Red; exit 1 }

$installer = "$env:TEMP\CraftLauncher-Setup.exe"
Write-Host ("⬇️  Baixando " + $asset.name + ' ...')
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $installer
if ((Get-Item $installer).Length -lt 50MB) { Write-Host '❌ Download incompleto/corrompido.' -ForegroundColor Red; exit 1 }

Write-Host '📦 Instalando (silencioso)...'
Start-Process -FilePath $installer -ArgumentList '/S' -Wait
Remove-Item $installer -ErrorAction SilentlyContinue

Write-Host ''
Write-Host '✅ Pronto! Abra "CraftLauncher" no Menu Iniciar para jogar.' -ForegroundColor Green
Write-Host '   Primeiro launch de cada versão baixa ~200-500 MB do Minecraft.'
Write-Host '   (Se o SmartScreen avisar, clique "Mais informações > Executar assim mesmo".)'
