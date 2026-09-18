# ⛏️ CraftLauncher 2 — Minecraft Java (offline)

Launcher premium em Electron: visual Minecraft, **Vanilla + Fabric + Forge + NeoForge + Quilt**, skins offline, mods em 1 clique e opções avançadas. **Funciona em Linux e Windows.**

## Instalação em 1 comando (Linux) ⚡
```bash
curl -fsSL https://raw.githubusercontent.com/contasuportedis-png/CraftLauncher/main/install.sh | bash
```
Isso instala o Java 21 (se faltar), baixa o AppImage da última release e cria o atalho no menu. Depois é só rodar `CraftLauncher`.

## Windows 🪟
**Instalação em 1 comando.**

No **PowerShell**, cole:
```powershell
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $f="$env:TEMP\cl-install.ps1"; (New-Object Net.WebClient).DownloadFile('https://raw.githubusercontent.com/contasuportedis-png/CraftLauncher/main/install.ps1',$f); if ((Get-Item $f).Length -lt 1KB) { Write-Host 'Falha no download. Abra o link no navegador e salve o arquivo.' } else { powershell -NoProfile -ExecutionPolicy Bypass -File $f }
```

No **CMD**, cole:
```bat
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $f=$env:TEMP+'\cl-install.ps1'; (New-Object Net.WebClient).DownloadFile('https://raw.githubusercontent.com/contasuportedis-png/CraftLauncher/main/install.ps1',$f); if ((Get-Item $f).Length -lt 1KB) { Write-Host 'Falha no download. Abra o link no navegador e salve o arquivo.' } else { Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',$f -Wait }"
```
Isso instala o Java 21 (se faltar), baixa o instalador da última release e instala silenciosamente. Depois abra `CraftLauncher` no Menu Iniciar.
- Alternativa manual: baixe `CraftLauncher.Setup.2.0.0.exe` na [release](https://github.com/contasuportedis-png/CraftLauncher/releases) (+ Java 21 em https://adoptium.net).
- Ou rode do código: instale [Node LTS](https://nodejs.org), depois `npm install` + `npm start` na pasta.
- Requer internet no primeiro launch de cada versão (~200–500 MB).

## Linux 🐧

## Requisitos
- Node 18+ / npm
- Java 17+ para MC 1.17+ (Java 21 cobre até a 1.21; Java 8 para 1.8–1.12)
- Internet no primeiro launch (~200–500 MB por versão)

## Rodar
```bash
cd /home/davi/Projetos/minecraft-launcher
npm start
# se der erro de sandbox/GPU no Linux:
npx electron . --no-sandbox
```

## O que tem de novo na v2
- **Visual refeito**: tema escuro Minecraft, cubo de grama, cards de vidro, 5 temas de destaque (Creeper, Diamante, Ouro, Redstone, Ametista), toasts, barras animadas
- **NeoForge** ⚡: lista versões 20.x/21.x + installer automático (`java -jar … --installClient`)
- **Quilt** 🪡: profile automático igual ao Fabric
- **Aba Versões**: busca + filtros release/snapshot/beta/alpha, grid com ★ na latest
- **Aba Mods**: lista com ativar/desativar/excluir + instalação em 1 clique via Modrinth (Sodium, Iris, Lithium, AppleSkin, OfflineSkins)
- **Aba Skins**: preview corpo inteiro, galeria local, modelo Classic/Slim
- **Aba Config**: presets de Java detectados, resolução + fullscreen, JVM args, game args, quick-join em servidor, modo demo, ação ao iniciar (manter/minimizar/ocultar), diagnóstico copiável
- **UUID offline estável** (v3 `OfflinePlayer:nick`) — mesmos mundos/saves sempre
- **Início**: status Mojang, RAM, Java, notícias (latest release/snapshot)

## Como jogar
1. Nickname livre (🎲 gera aleatório) → UUID offline fixo e estável
2. Escolha versão (ex: 1.20.1) + modloader (pills na lateral)
3. **JOGAR** → acompanhe download nos logs (aba Modloaders)
4. Se o jogo fechar em segundos, os logs mostram `DIAGNÓSTICO:` com a causa (Java/RAM/versão)

## Mods em 1 clique (catálogo)
- **Performance**: Sodium/Embeddium, Lithium/Canary, FerriteCore, ModernFix, Entity Culling, Krypton, LazyDFU
- **Gráficos**: Iris/Oculus, Sodium Extra, Dynamic Lights
- **Utilidades**: AppleSkin, JEI, Jade, WTHIT, JourneyMap, Mod Menu, Cloth Config
- **Mundo & skins**: Terralith, Skin Shuffle + OfflineSkins/StraySkins (botão ✨)
- O launcher escolhe o **slug certo para cada loader** (ex: no Forge instala Embeddium/Oculus no lugar de Sodium/Iris), troca sozinho p/ Fabric quando preciso e avisa se o mod não existe p/ sua versão (dizendo em quais existe).

## Modloaders
| Loader | Versões | Instalação |
|---|---|---|
| Vanilla | todas | automática |
| Fabric | todas | profile automático |
| Quilt | todas | profile automático |
| Forge | até 1.20.1 | botão ⬇ Instalar (installer oficial, ~300 MB, 3–10 min) |
| NeoForge | 1.20.2+ / 1.21 | botão ⬇ Instalar (installer oficial, ~300 MB, 3–10 min) |

> Detalhe técnico: o installer oficial exige um `launcher_profiles.json` no destino — o launcher cria um automaticamente. Após instalar, a versão do jogo é ajustada sozinha se o loader exigir outra (ex: NeoForge 21.11.x → MC 1.21.11) e o profile é validado pelo `inheritsFrom` antes de jogar.

## Skins offline
1. 🎨 Enviar PNG 64×64 → vai para a galeria + `skins/skin.png`
2. ✨ Ativar no jogo → instala OfflineSkins (troca p/ Fabric se estava Vanilla)
3. Sem mod = Steve/Alex (limitação do offline)

## Build
```bash
npm run dist   # AppImage/deb (linux) ou nsis (win)
```

## Stack
- Electron 33 + minecraft-launcher-core 3.18 + electron-store
- Mojang piston-meta · Fabric Meta · Quilt Meta · Forge promotions · NeoForge Maven · Modrinth API
