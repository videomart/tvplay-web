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
}
