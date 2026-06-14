export const config = {
  port: parseInt(process.env.PORT ?? '3001', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',

  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },

  minio: {
    endpoint: process.env.MINIO_ENDPOINT ?? 'localhost',
    port: parseInt(process.env.MINIO_PORT ?? '9000', 10),
    accessKey: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin123',
    useSSL: process.env.MINIO_USE_SSL === 'true',
    bucket: process.env.MINIO_BUCKET ?? 'tvplay-media',
  },

  ffmpeg: {
    path: process.env.FFMPEG_PATH ?? 'ffmpeg',
    probePath: process.env.FFPROBE_PATH ?? 'ffprobe',
  },

  ytdlp: {
    // Caminho para arquivo de cookies do YouTube (formato Netscape/cookies.txt)
    // Necessário em servidores cloud/VPS onde o YouTube bloqueia IPs de datacenter
    cookiesFile: process.env.YTDLP_COOKIES_FILE ?? '',
    // YouTube bloqueia quase todas as requisições yt-dlp originadas de IPs de
    // datacenter ("Sign in to confirm you're not a bot") — cookies não resolvem
    // o problema de forma confiável. Em servidores VPS, defina YTDLP_ENABLED=false
    // para pular as tentativas (evita timeouts de até 60s x 5 clients por chamada)
    // e degradar direto para o fallback. Padrão: habilitado (uso local/desktop).
    enabled: process.env.YTDLP_ENABLED !== 'false',
  },

  storage: {
    hlsOutputPath: process.env.HLS_OUTPUT_PATH ?? './storage/hls',
    transcodeOutputPath: process.env.TRANSCODE_OUTPUT_PATH ?? './storage/transcoded',
  },
}

// Mensagem exibida quando o usuário tenta usar/visualizar conteúdo YouTube/Twitch
// num servidor com YTDLP_ENABLED=false (ex.: VPS).
export const YTDLP_DISABLED_ERROR =
  'Conteúdo do YouTube/Twitch não está disponível neste servidor — recurso restrito ao ambiente local (IPs de VPS são bloqueados pelo YouTube).'
