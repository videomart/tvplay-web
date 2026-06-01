import ffmpeg from 'fluent-ffmpeg'
import path from 'path'
import fs from 'fs'
import { config } from '../config'

ffmpeg.setFfmpegPath(config.ffmpeg.path)
ffmpeg.setFfprobePath(config.ffmpeg.probePath)

export interface MediaProbe {
  duration: number
  width: number
  height: number
  fps: number
  bitrate: number
  videoCodec: string
  audioCodec: string
}

export async function probeMedia(filePath: string): Promise<MediaProbe> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err)

      const videoStream = metadata.streams.find((s) => s.codec_type === 'video')
      const audioStream = metadata.streams.find((s) => s.codec_type === 'audio')

      const fps = (() => {
        const r = videoStream?.r_frame_rate
        if (!r) return 25
        const [num, den] = r.split('/').map(Number)
        return den ? num / den : num
      })()

      resolve({
        duration: metadata.format.duration ?? 0,
        width: videoStream?.width ?? 0,
        height: videoStream?.height ?? 0,
        fps,
        bitrate: parseInt(String(metadata.format.bit_rate ?? '0'), 10),
        videoCodec: videoStream?.codec_name ?? 'unknown',
        audioCodec: audioStream?.codec_name ?? 'unknown',
      })
    })
  })
}

export async function generateThumbnail(
  inputPath: string,
  outputDir: string,
  timeOffset = 2,
): Promise<string> {
  fs.mkdirSync(outputDir, { recursive: true })
  const outputFile = path.join(outputDir, `thumb_${Date.now()}.jpg`)

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .screenshots({ timestamps: [timeOffset], filename: path.basename(outputFile), folder: outputDir, size: '320x180' })
      .on('end', () => resolve(outputFile))
      .on('error', reject)
  })
}

export async function transcodeToHLS(
  inputPath: string,
  outputDir: string,
  mediaId: string,
): Promise<string> {
  const hlsDir = path.join(outputDir, mediaId)
  fs.mkdirSync(hlsDir, { recursive: true })
  const playlistPath = path.join(hlsDir, 'index.m3u8')
  const segmentPattern = path.join(hlsDir, 'seg%03d.ts')

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .addOptions([
        '-map 0:v:0',
        '-map 0:a:0?',                                         // áudio opcional (evita erro em vídeos sem áudio)
        '-pix_fmt yuv420p',                                    // força 8-bit (compatibilidade HLS)
        '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2',              // dimensões divisíveis por 2
        '-profile:v main',
        '-level 4.0',
        '-preset fast',
        '-crf 23',
        '-g 48',
        '-keyint_min 48',
        '-ac 2',                                               // downmix para estéreo
        '-hls_time 6',
        '-hls_playlist_type vod',
        `-hls_segment_filename ${segmentPattern}`,
      ])
      .output(playlistPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run()
  })

  // FFmpeg embute o caminho absoluto no .m3u8 — reescreve para usar só basename
  const m3u8 = fs.readFileSync(playlistPath, 'utf-8')
  const fixed = m3u8.replace(new RegExp(hlsDir.replace(/\\/g, '/') + '/', 'g'), '')
               .replace(new RegExp(hlsDir + '/', 'g'), '')
  fs.writeFileSync(playlistPath, fixed)

  return playlistPath
}

// Converte imagem estática em vídeo HLS com loop (duração padrão 30s, substituível pelo cueOut do clipe)
export async function transcodeImageToHLS(
  inputPath: string,
  outputDir: string,
  mediaId: string,
  durationSecs = 30,
): Promise<{ playlistPath: string; width: number; height: number }> {
  const hlsDir = path.join(outputDir, mediaId)
  fs.mkdirSync(hlsDir, { recursive: true })
  const playlistPath  = path.join(hlsDir, 'index.m3u8')
  const segmentPattern = path.join(hlsDir, 'seg%03d.ts')

  // Obtém dimensões da imagem via ffprobe
  const dims = await new Promise<{ width: number; height: number }>((resolve) => {
    ffmpeg.ffprobe(inputPath, (err, meta) => {
      const vs = meta?.streams?.find((s: any) => s.codec_type === 'video')
      resolve({ width: vs?.width ?? 1280, height: vs?.height ?? 720 })
    })
  })

  // Normaliza para dimensões pares (libx264 exige divisível por 2)
  const w = dims.width  % 2 === 0 ? dims.width  : dims.width  - 1
  const h = dims.height % 2 === 0 ? dims.height : dims.height - 1

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .inputOptions(['-loop', '1', '-r', '25'])
      .videoCodec('libx264')
      .addOptions([
        `-t ${durationSecs}`,
        `-vf scale=${w}:${h}`,
        '-pix_fmt yuv420p',
        '-profile:v main',
        '-level 4.0',
        '-preset fast',
        '-crf 23',
        '-g 50',
        '-keyint_min 50',
        '-an',                    // sem áudio (lavfi não disponível neste build)
        '-hls_time 6',
        '-hls_playlist_type vod',
        `-hls_segment_filename ${segmentPattern}`,
      ])
      .output(playlistPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run()
  })

  const m3u8 = fs.readFileSync(playlistPath, 'utf-8')
  const fixed = m3u8.replace(new RegExp(hlsDir.replace(/\\/g, '/') + '/', 'g'), '')
                    .replace(new RegExp(hlsDir + '/', 'g'), '')
  fs.writeFileSync(playlistPath, fixed)

  return { playlistPath, width: w, height: h }
}

export async function transcodeToMP4(
  inputPath: string,
  outputPath: string,
): Promise<string> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .addOptions(['-movflags +faststart', '-preset fast', '-crf 23'])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run()
  })
}

export async function getLoudness(filePath: string): Promise<{ integrated: number; truePeak: number }> {
  return new Promise((resolve, reject) => {
    let output = ''
    ffmpeg(filePath)
      .audioFilters('ebur128=peak=true')
      .format('null')
      .output('/dev/null')
      .on('stderr', (line: string) => { output += line })
      .on('end', () => {
        const integrated = parseFloat(output.match(/I:\s+([-\d.]+)\s+LUFS/)?.[1] ?? '0')
        const truePeak = parseFloat(output.match(/True peak:\s+Peak:\s+([-\d.]+)\s+dBFS/)?.[1] ?? '0')
        resolve({ integrated, truePeak })
      })
      .on('error', reject)
      .run()
  })
}
