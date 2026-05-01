FROM node:20-alpine

RUN apk add --no-cache ffmpeg python3 py3-pip make g++ openssl openssl-dev libc6-compat v4l-utils && \
    pip3 install --no-cache-dir --break-system-packages yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

EXPOSE 3001

CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node dist/server.js"]
