#!/usr/bin/env bash
# CraftLauncher — instalador Linux em um comando:
#   curl -fsSL https://raw.githubusercontent.com/contasuportedis-png/CraftLauncher/main/install.sh | bash
set -euo pipefail

REPO="contasuportedis-png/CraftLauncher"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$HOME/.local/share/applications"
APP="$BIN_DIR/CraftLauncher.AppImage"

echo "⛏️  Instalando CraftLauncher..."

have_java() {
  command -v java >/dev/null 2>&1 && java -version 2>&1 | grep -qE '"(1[7-9]|[2-9][0-9])\.'
}

if ! have_java; then
  echo "☕ Java 17+ não encontrado. Tentando instalar openjdk-21-jre..."
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update && sudo apt-get install -y openjdk-21-jre || {
      echo "❌ Instale o Java 21 manualmente: https://adoptium.net"; exit 1
    }
  else
    echo "❌ Instale o Java 21 manualmente: https://adoptium.net"; exit 1
  fi
fi
echo "☕ $(java -version 2>&1 | head -1)"

mkdir -p "$BIN_DIR" "$DESKTOP_DIR"

echo "🔎 Localizando última versão..."
URL="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep -oE 'https://[^"]*\.AppImage' | head -1)"
[ -n "${URL:-}" ] || { echo "❌ Falha ao localizar o AppImage na release."; exit 1; }

echo "⬇️  Baixando CraftLauncher..."
curl -fSL --progress-bar -o "$APP" "$URL"
[ "$(stat -c%s "$APP")" -gt 50000000 ] || { echo "❌ Download incompleto/corrompido."; exit 1; }
chmod +x "$APP"

cat > "$DESKTOP_DIR/craftlauncher.desktop" <<EOF
[Desktop Entry]
Name=CraftLauncher
Comment=Minecraft Java Edition (offline)
Exec=$APP %U
Terminal=false
Type=Application
Categories=Game;
EOF
update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true

echo ""
echo "✅ Pronto! Para jogar rode no terminal: CraftLauncher"
echo "   (ou abra 'CraftLauncher' no menu de aplicativos)"
echo "   Primeiro launch de cada versão baixa ~200-500 MB do Minecraft."
