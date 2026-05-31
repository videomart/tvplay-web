FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Hash do commit passado pelo docker compose (VITE_APP_BUILD=<hash> docker compose up --build)
ARG VITE_APP_BUILD=""
ENV VITE_APP_BUILD=$VITE_APP_BUILD
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
