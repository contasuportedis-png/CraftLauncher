#!/usr/bin/env bash
# CraftLauncher — instalador Linux em um comando:
#   curl -fsSL https://raw.githubusercontent.com/contasuportedis-png/CraftLauncher/main/install.sh | bash
set -euo pipefail

REPO="contasuportedis-png/CraftLauncher"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$HOME/.local/share/applications"
APP="$BIN_DIR/CraftLauncher.AppImage"
MARKER_DIR="$HOME/.local/share/craftlauncher"
FORCE=0
# Rodar de novo = atualizar. Use --force para baixar mesmo se já atual.
if [ "${1:-}" = "--force" ] || [ "${1:-}" = "-f" ]; then FORCE=1; fi

echo "⛏️  CraftLauncher — instalação/atualização..."

have_java() {
  command -v java >/dev/null 2>&1 && java -version 2>&1 | grep -qE '"(1[7-9]|[2-9][0-9])\.'
}

if ! have_java; then
  echo "☕ Java 17+ não encontrado no sistema — sem problema: o app baixa sozinho ao jogar."
  if command -v apt-get >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    echo "Tentando instalar via apt (sem senha)..."
    sudo apt-get install -y openjdk-21-jre 2>/dev/null || true
  fi
  echo "Dica: você também pode instalar depois em https://adoptium.net (Java 21)."
else
  echo "☕ $(java -version 2>&1 | head -1)"
fi

mkdir -p "$BIN_DIR" "$DESKTOP_DIR"

command -v curl >/dev/null 2>&1 || { echo "❌ curl não encontrado. Instale com: sudo apt install curl"; exit 1; }

echo "🔎 Localizando última versão..."
TMPREL="${TMPDIR:-/tmp}/cl-rel.json"
REL_OK=0
for i in 1 2 3; do
  CODE="$(curl -sSL -o "$TMPREL" -w "%{http_code}" "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null || echo 000)"
  if [ "$CODE" = "200" ]; then REL_OK=1; break; fi
  echo "Tentativa $i falhou (HTTP $CODE), tentando de novo em 2s..." >&2
  sleep 2
done
TAG=""; URL=""
if [ "$REL_OK" = "1" ]; then
  REL_JSON="$(cat "$TMPREL")"
  TAG="$(echo "$REL_JSON" | grep -oE '"tag_name": *"[^"]+"' | head -1 | cut -d'"' -f4)"
  URL="$(echo "$REL_JSON" | grep -oE 'https://[^"]*\.AppImage' | head -1)"
fi
rm -f "$TMPREL"
if [ -z "${URL:-}" ] && command -v git >/dev/null 2>&1; then
  echo "API do GitHub indisponível — tentando método alternativo (git)..." >&2
  TAG="$(git ls-remote --tags --sort=-v:refname "https://github.com/$REPO.git" 2>/dev/null | grep -oE 'refs/tags/v[0-9][0-9.]*' | head -1 | cut -d/ -f3)"
  if [ -n "${TAG:-}" ]; then
    URL="https://github.com/$REPO/releases/download/$TAG/CraftLauncher-${TAG#v}.AppImage"
  fi
fi
[ -n "${URL:-}" ] || { echo "❌ Falha ao localizar o AppImage na release (rede ou limite da API do GitHub). Tente de novo em alguns minutos ou baixe manual em: https://github.com/$REPO/releases/latest"; exit 1; }
echo "📦 Última versão: ${TAG:-desconhecida}"

INSTALLED="nenhuma"
[ -f "$MARKER_DIR/version" ] && INSTALLED="$(cat "$MARKER_DIR/version")"
if [ "$FORCE" = "0" ] && [ -n "${TAG:-}" ] && [ "$INSTALLED" = "$TAG" ] && [ -x "$APP" ]; then
  echo "✅ Já está atualizado (${TAG}). Rode: CraftLauncher"
  echo "   (use --force para baixar de novo)"
  exit 0
fi

echo "⬇️  Baixando CraftLauncher..."
# baixa em arquivo temporário + move atômico: funciona mesmo com o app ABERTO
# (sobrescrever o binário em execução dá "Text file busy")
TMPAPP="$APP.download"
rm -f "$TMPAPP"
curl -fSL --progress-bar -o "$TMPAPP" "$URL"
[ "$(stat -c%s "$TMPAPP")" -gt 50000000 ] || { echo "❌ Download incompleto/corrompido."; rm -f "$TMPAPP"; exit 1; }
chmod +x "$TMPAPP"
mv -f "$TMPAPP" "$APP"
if pgrep -f "CraftLauncher.AppImage" >/dev/null 2>&1; then
  echo "ℹ️  O app estava aberto — feche e abra de novo para usar a nova versão."
fi
# atalho `CraftLauncher` no PATH
ln -sf "$APP" "$BIN_DIR/CraftLauncher"

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
mkdir -p "$MARKER_DIR"
[ -n "${TAG:-}" ] && echo "$TAG" > "$MARKER_DIR/version"

echo ""
echo "✅ Pronto! (versão ${TAG:-atual}) Para jogar rode no terminal: CraftLauncher"
echo "   (ou abra 'CraftLauncher' no menu de aplicativos)"
echo "   Primeiro launch de cada versão baixa ~200-500 MB do Minecraft."
if ! ldconfig -p 2>/dev/null | grep -q libfuse.so.2; then
  echo ""
  echo "⚠️  Se o app não abrir (erro de FUSE), instale com: sudo apt install libfuse2"
  echo "   Alternativa sem FUSE: baixe o .deb em https://github.com/$REPO/releases/latest"
fi
