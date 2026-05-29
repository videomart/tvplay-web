#!/usr/bin/env bash
# ─── TVPlay Web — Deploy Script ───────────────────────────────────────────────
# Uso: ./deploy.sh [--skip-cookies]
# Flags:
#   --skip-cookies   Não copia youtube-cookies.txt (arquivo já existe no servidor)
# ─────────────────────────────────────────────────────────────────────────────

set -e
cd "$(dirname "$0")"

SKIP_COOKIES=false
for arg in "$@"; do [[ "$arg" == "--skip-cookies" ]] && SKIP_COOKIES=true; done

echo ""
echo "═══════════════════════════════════════════"
echo "  TVPlay Web — Deploy $(date '+%Y-%m-%d %H:%M')"
echo "═══════════════════════════════════════════"

# 1. Pull do repositório
echo ""
echo "▶ 1/4  Atualizando código (git pull)..."
git pull origin main

# 2. Copiar cookies do YouTube (se existir localmente)
if [ "$SKIP_COOKIES" = false ]; then
  if [ -f "./youtube-cookies.txt" ] && [ -s "./youtube-cookies.txt" ]; then
    echo "▶ 2/4  Cookies do YouTube encontrados — OK"
  else
    echo "⚠  2/4  youtube-cookies.txt não encontrado ou vazio."
    echo "        Execute novamente após copiar o arquivo de cookies."
    echo "        Ou use --skip-cookies se o arquivo já existe no servidor."
    exit 1
  fi
else
  echo "▶ 2/4  --skip-cookies: usando cookies já existentes no servidor"
fi

# 3. Rebuild dos containers (backend + frontend)
echo ""
echo "▶ 3/4  Rebuild dos containers..."
docker compose up -d --build --remove-orphans

# 4. Aguardar API ficar saudável
echo ""
echo "▶ 4/4  Aguardando API inicializar..."
for i in $(seq 1 24); do
  if curl -sf http://localhost:3001/health > /dev/null 2>&1; then
    echo "   ✓ API respondendo em http://localhost:3001"
    break
  fi
  if [ $i -eq 24 ]; then
    echo "   ✗ API não respondeu em 120s — verifique: docker logs tvplay_api"
    exit 1
  fi
  echo "   ... aguardando ($((i*5))s)"
  sleep 5
done

echo ""
echo "═══════════════════════════════════════════"
echo "  ✓ Deploy concluído!"
echo "  Frontend : http://localhost:3000"
echo "  API      : http://localhost:3001"
echo "═══════════════════════════════════════════"
echo ""
