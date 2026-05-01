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

      const fps = videoStream?.r_frame_rate
        ? eval(videoStream.r_frame_rate)
        : 25

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

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .addOptions([
        '-profile:v main',
        '-level 4.0',
        '-preset fast',
        '-crf 23',
        '-sc_threshold 0',
        '-g 48',
        '-keyint_min 48',
        '-hls_time 6',
        '-hls_playlist_type vod',
        '-hls_segment_filename', path.join(hlsDir, 'seg%03d.ts'),
      ])
      .output(playlistPath)
      .on('end', () => resolve(playlistPath))
      .on('error', reject)
      .run()
  })
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
