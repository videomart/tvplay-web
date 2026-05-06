FROM mwader/static-ffmpeg:latest AS ffmpeg-static

FROM node:20-alpine

COPY --from=ffmpeg-static /ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg-static /ffprobe /usr/local/bin/ffprobe

RUN apk add --no-cache python3 py3-pip make g++ openssl openssl-dev libc6-compat v4l-utils \
        fontconfig ttf-freefont && \
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

CMD ["sh", "-c", "pip3 install --upgrade --break-system-packages yt-dlp --quiet 2>/dev/null & i=0; until npx prisma db push --accept-data-loss; do i=$((i+1)); [ $i -ge 5 ] && echo 'prisma db push falhou após 5 tentativas' && exit 1; echo \"Retry $i/5 em 5s...\"; sleep 5; done && node prisma/seed.js && node dist/server.js"]
