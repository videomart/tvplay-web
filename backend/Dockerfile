FROM mwader/static-ffmpeg:latest AS ffmpeg-static

# Build separado de um FFmpeg com --enable-decklink, usado só pelas saídas
# SDI (Blackmagic DeckLink) — o binário estático acima (ffmpeg-static) não
# tem esse suporte (não é possível linkar contra o SDK proprietário da
# Blackmagic num build genérico de terceiros). Precisa dos headers do
# DeckLink SDK em backend/decklink-sdk/include/ (download manual, licenciado,
# não commitado — ver .gitignore e OPERATIONS_MANUAL.md seção 8). A lib
# libDeckLinkAPI.so real (runtime, do driver instalado no host) NÃO entra
# aqui — é montada via volume no docker-compose.yml, não em build time.
# --enable-nonfree é exigido pelo configure do FFmpeg especificamente por
# causa do --enable-decklink (fora isso o resto do build seguiria GPL puro).
FROM ubuntu:24.04 AS ffmpeg-decklink-builder
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates git build-essential pkg-config yasm nasm && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY decklink-sdk/include /build/decklink-sdk/include
# .gitkeep garante que a pasta sempre existe (até em checkout sem o SDK real,
# que é gitignored) — se DeckLinkAPI.h não estiver lá, pula o build em vez de
# quebrar a imagem inteira pra quem não tem/não precisa de saída SDI (ex.: a
# VPS de produção, que não tem placa DeckLink nenhuma até o momento).
RUN mkdir -p /opt/ffmpeg-decklink/bin && \
    if [ -f /build/decklink-sdk/include/DeckLinkAPI.h ]; then \
      git clone --depth 1 --branch n9.0.2 https://github.com/FFmpeg/FFmpeg.git ffmpeg && \
      cd ffmpeg && \
      ./configure \
        --prefix=/opt/ffmpeg-decklink \
        --extra-cflags="-I/build/decklink-sdk/include" \
        --extra-cxxflags="-I/build/decklink-sdk/include" \
        --enable-gpl --enable-nonfree --enable-decklink \
        --disable-doc --disable-debug && \
      make -j"$(nproc)" && make install; \
    else \
      echo "[decklink] DeckLinkAPI.h ausente em backend/decklink-sdk/include/ -- build pulado, saida SDI nao vai funcionar nesta imagem" >&2 && \
      printf '#!/bin/sh\necho "ffmpeg-decklink: SDK Blackmagic nao estava presente no build desta imagem -- saida SDI indisponivel" >&2\nexit 1\n' > /opt/ffmpeg-decklink/bin/ffmpeg && \
      chmod +x /opt/ffmpeg-decklink/bin/ffmpeg; \
    fi

# Ubuntu 24.04 — compatível com os pacotes .deb do TSDuck (mesma base do scte-monitor)
FROM ubuntu:24.04

COPY --from=ffmpeg-static /ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg-static /ffprobe /usr/local/bin/ffprobe
COPY --from=ffmpeg-decklink-builder /opt/ffmpeg-decklink/bin/ffmpeg /usr/local/bin/ffmpeg-decklink

# Node.js 22 + TSDuck (injeção SCTE-35 via tsp) + dependências de sistema
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl ca-certificates gnupg git make g++ \
        python3 python3-pip \
        v4l-utils fontconfig fonts-freefont-ttf \
        libgomp1 libatomic1 && \
    # Node.js 22 via NodeSource
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    # TSDuck — pacote oficial para Ubuntu 24
    ARCH="$(dpkg --print-architecture)" && \
    curl -fsSL -o /tmp/tsduck.deb \
      "https://github.com/tsduck/tsduck/releases/download/v3.44-4676/tsduck_3.44-4676.ubuntu24_${ARCH}.deb" && \
    apt-get install -y --no-install-recommends /tmp/tsduck.deb && \
    rm -rf /tmp/tsduck.deb /var/lib/apt/lists/* && \
    fc-cache -f && \
    pip3 install --no-cache-dir --break-system-packages yt-dlp && \
    # PO Token provider (bgutil) para o client "web" do yt-dlp — sem PO token o
    # YouTube recusa formatos com "GVS PO Token which was not provided" mesmo
    # de IP residencial (confirmado 2026-08-24: não é bloqueio de IP de
    # datacenter, como se assumia antes — ver YT_CLIENTS/resolveViaYtDlp em
    # playout.service.ts e o comentário em config.ts). Build em tempo de
    # imagem, path fixo (YTDLP_POT_SERVER_HOME em config.ts), pra não clonar/
    # compilar a cada boot do container.
    pip3 install --no-cache-dir --break-system-packages bgutil-ytdlp-pot-provider && \
    git clone --quiet --single-branch --branch 1.3.2 \
      https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-ytdlp-pot-provider && \
    cd /opt/bgutil-ytdlp-pot-provider/server && \
    npm ci --include=dev && node_modules/.bin/tsc && npm prune --omit=dev && \
    cd /

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

EXPOSE 3001

CMD ["sh", "-c", "mkdir -p /app/cookies && [ ! -f /app/cookies/youtube-cookies.txt ] && touch /app/cookies/youtube-cookies.txt; pip3 install --upgrade --break-system-packages yt-dlp --quiet 2>/dev/null || true && yt-dlp --version && i=0; until npx prisma db push --accept-data-loss; do i=$((i+1)); [ $i -ge 5 ] && echo 'prisma db push falhou após 5 tentativas' && exit 1; echo \"Retry $i/5 em 5s...\"; sleep 5; done && node prisma/seed.js && node dist/server.js"]
