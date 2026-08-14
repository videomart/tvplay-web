FROM mwader/static-ffmpeg:latest AS ffmpeg-static

# Ubuntu 24.04 — compatível com os pacotes .deb do TSDuck (mesma base do scte-monitor)
FROM ubuntu:24.04

COPY --from=ffmpeg-static /ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg-static /ffprobe /usr/local/bin/ffprobe

# Node.js 22 + TSDuck (injeção SCTE-35 via tsp) + dependências de sistema
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl ca-certificates gnupg make g++ \
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
    pip3 install --no-cache-dir --break-system-packages yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

EXPOSE 3001

CMD ["sh", "-c", "mkdir -p /app/cookies && [ ! -f /app/cookies/youtube-cookies.txt ] && touch /app/cookies/youtube-cookies.txt; pip3 install --upgrade --break-system-packages yt-dlp --quiet 2>/dev/null || true && yt-dlp --version && i=0; until npx prisma db push --accept-data-loss; do i=$((i+1)); [ $i -ge 5 ] && echo 'prisma db push falhou após 5 tentativas' && exit 1; echo \"Retry $i/5 em 5s...\"; sleep 5; done && node prisma/seed.js && node dist/server.js"]
