# CraftLauncher — instalador Windows em um comando.
#
# No PowerShell, cole:
#   irm https://raw.githubusercontent.com/contasuportedis-png/CraftLauncher/main/install.ps1 | iex
#
# Se der erro de política de execução, use no CMD:
#   powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/contasuportedis-png/CraftLauncher/main/install.ps1 | iex"
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # download 10x mais rápido no PS 5.1
$Repo = 'contasuportedis-png/CraftLauncher'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

Write-Host '⛏️  Instalando CraftLauncher...' -ForegroundColor Green

function Get-JavaOutput {
  # Roda `java -version` redirecionando para ARQUIVO: evita que o stderr vire
  # NativeCommandError no PowerShell 5.1 (que quebra com $ErrorActionPreference='Stop').
  $tmp = "$env:TEMP\cl-java.txt"
  try {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    $p = Start-Process -FilePath 'java' -ArgumentList '-version' -NoNewWindow -Wait -PassThru `
      -RedirectStandardOutput $tmp -RedirectStandardError $tmp -ErrorAction Stop
    $out = ''
    if (Test-Path $tmp) { $out = Get-Content $tmp -Raw -ErrorAction SilentlyContinue }
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    return $out
  } catch { return '' }
}

function Get-JavaMajor {
  $out = Get-JavaOutput
  if ($out -match '"(\d+)\.') { return [int]$Matches[1] }
  return 0
}

function Get-JavaDesc {
  $out = Get-JavaOutput
  if ($out) { return ($out.Split("`n")[0].Trim()) }
  return 'Java'
}

function Install-JavaAuto {
  # 1) winget (Windows 10/11) — caminho mais limpo
  try {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
      Write-Host 'Instalando Java 21 via winget...' -ForegroundColor Yellow
      $wlog = "$env:TEMP\cl-winget.log"
      $wp = Start-Process winget -ArgumentList 'install','-e','--id','EclipseAdoptium.Temurin.21.JRE','--silent','--accept-package-agreements','--accept-source-agreements','--disable-interactivity' `
        -NoNewWindow -Wait -PassThru -RedirectStandardOutput $wlog -RedirectStandardError $wlog -ErrorAction Stop
      Remove-Item $wlog -Force -ErrorAction SilentlyContinue
      $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
      if ((Get-JavaMajor) -ge 17) { return $true }
      Write-Host 'winget não resolveu, tentando modo portable...' -ForegroundColor Yellow
    }
  } catch {
    Write-Host 'winget indisponível, tentando modo portable...' -ForegroundColor Yellow
  }
  # 2) zip portable — funciona sempre, sem admin (Temurin, reserva Microsoft)
  $sources = @(
    @{ name = 'Temurin 21 JRE'; url = 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse' },
    @{ name = 'Microsoft JDK 21'; url = 'https://aka.ms/download-jdk/microsoft-jdk-21-windows-x64.zip' }
  )
  foreach ($src in $sources) {
    try {
      Write-Host ("Baixando Java portable (" + $src.name + ", ~190 MB, aguarde)...") -ForegroundColor Yellow
      $zip = "$env:TEMP\cl-java21.zip"
      Remove-Item $zip -Force -ErrorAction SilentlyContinue
      Invoke-WebRequest -UseBasicParsing -Uri $src.url -OutFile $zip
      $sizeMB = ((Get-Item $zip).Length / 1MB)
      Write-Host ("Baixado: {0:N1} MB" -f $sizeMB)
      if ($sizeMB -lt 50) { throw ("zip incompleto ({0:N1} MB)" -f $sizeMB) }
      $dest = "$env:LOCALAPPDATA\Programs\CL-Java21"
      if (Test-Path $dest) { Remove-Item $dest -Recurse -Force -ErrorAction Stop }
      Write-Host 'Extraindo (pode levar 1-2 min)...' -ForegroundColor Yellow
      Expand-Archive -Path $zip -DestinationPath $dest -Force -ErrorAction Stop
      Remove-Item $zip -Force -ErrorAction SilentlyContinue
      $javaExe = Get-ChildItem -Path $dest -Recurse -Filter 'java.exe' -ErrorAction Stop |
        Where-Object { $_.FullName -like '*\bin\java.exe' } | Select-Object -First 1
      if (-not $javaExe) {
        $top = (Get-ChildItem -Path $dest -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name) -join ', '
        Write-Host ("Extraiu mas sem java.exe. Conteúdo: " + ($top | Out-String)) -ForegroundColor Yellow
        Write-Host 'Se a pasta está vazia, o antivírus pode ter removido os arquivos — pausse-o e tente de novo.' -ForegroundColor Yellow
        continue
      }
      $binDir = $javaExe.DirectoryName
      Write-Host ("Java encontrado: " + $javaExe.FullName)
      $userPath = [Environment]::GetEnvironmentVariable('Path','User')
      if ($userPath -notlike "*$binDir*") {
        [Environment]::SetEnvironmentVariable('Path', "$userPath;$binDir", 'User')
      }
      [Environment]::SetEnvironmentVariable('JAVA_HOME', (Split-Path $binDir), 'User')
      $env:Path = "$env:Path;$binDir"
      $env:JAVA_HOME = (Split-Path $binDir)
      if ((Get-JavaMajor) -ge 17) { return $true }
      Write-Host 'java.exe não respondeu à verificação, tentando próxima fonte...' -ForegroundColor Yellow
    } catch {
      Write-Host ("Fonte " + $src.name + " falhou: " + $_.Exception.Message) -ForegroundColor Yellow
    }
  }
  return $false
}

if ((Get-JavaMajor) -lt 17) {
  Write-Host '☕ Java 17+ não encontrado. Instalando automaticamente...' -ForegroundColor Yellow
  if (-not (Install-JavaAuto)) {
    Write-Host '❌ Não consegui instalar o Java sozinho.' -ForegroundColor Red
    Write-Host '   Instale manualmente em https://adoptium.net (versão 21, JRE Windows x64)'
    Write-Host '   e rode este comando de novo.'
    exit 1
  }
}
Write-Host ("☕ " + (Get-JavaDesc))

try {
  Write-Host '🔎 Localizando última versão...'
  $rel = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$Repo/releases/latest"
  $asset = $rel.assets | Where-Object { $_.name -like '*Setup*.exe' } | Select-Object -First 1
  if (-not $asset) { throw 'Instalador .exe não encontrado na release.' }

  $installer = "$env:TEMP\CraftLauncher-Setup.exe"
  Write-Host ("⬇️  Baixando " + $asset.name + ' (~80 MB, aguarde)...')
  Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $installer
  if ((Get-Item $installer).Length -lt 50MB) { throw 'Download incompleto/corrompido.' }

  Write-Host '📦 Instalando (silencioso)...'
  Start-Process -FilePath $installer -ArgumentList '/S' -Wait
  Remove-Item $installer -ErrorAction SilentlyContinue
} catch {
  Write-Host ('❌ Erro: ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host '   Alternativa: baixe e rode manualmente em:'
  Write-Host ("   https://github.com/$Repo/releases/latest")
  exit 1
}

Write-Host ''
Write-Host '✅ Pronto! Abra "CraftLauncher" no Menu Iniciar para jogar.' -ForegroundColor Green
Write-Host '   Primeiro launch de cada versão baixa ~200-500 MB do Minecraft.'
Write-Host '   (Se o SmartScreen avisar, clique "Mais informações > Executar assim mesmo".)'
