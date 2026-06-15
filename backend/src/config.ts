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
  },

  storage: {
    hlsOutputPath: process.env.HLS_OUTPUT_PATH ?? './storage/hls',
    transcodeOutputPath: process.env.TRANSCODE_OUTPUT_PATH ?? './storage/transcoded',
  },

  // Sinalização direta de eventos SCTE-35 para um receptor remoto (ex.: M1).
  // Usado quando o relay FFmpeg não encaminha PID 0x0500 pelo container mpegts.
  // Deixar em branco para desabilitar.
  scteSignal: {
    url:      process.env.SCTE_SIGNAL_URL       ?? '',  // Ex.: http://vps1.tvtupi.com.br:3001/api/input-sources/scte-signal
    sourceId: process.env.SCTE_SIGNAL_SOURCE_ID ?? '',  // ID do InputSource no receptor remoto
    secret:   process.env.SCTE_SIGNAL_SECRET    ?? '',  // Segredo compartilhado (header x-scte-secret)
  },
}

// Mensagem exibida quando o usuário tenta usar/visualizar conteúdo YouTube/Twitch
// num servidor com a opção "Conteúdo YouTube/Twitch" desligada em Configurações (ex.: VPS).
export const YTDLP_DISABLED_ERROR =
  'Conteúdo do YouTube/Twitch não está disponível neste servidor — recurso restrito ao ambiente local (IPs de VPS são bloqueados pelo YouTube).'
