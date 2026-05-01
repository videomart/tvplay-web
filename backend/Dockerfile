FROM node:20-alpine

RUN apk add --no-cache ffmpeg python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
