import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../package.json', import.meta.url))

export function ffmpegBinaryPath() {
  const fromEnv = process.env.FFMPEG_PATH?.trim()
  if (fromEnv) return fromEnv
  const bundled = require('ffmpeg-static')
  if (typeof bundled !== 'string' || !bundled) {
    throw new Error('ffmpeg is not available')
  }
  return bundled
}

function runProcess(command, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

async function writeStatus(supabase, statusPath, record) {
  const body = Buffer.from(JSON.stringify(record))
  await supabase.storage.from('maintenance-uploads').upload(statusPath, body, {
    contentType: 'application/json',
    upsert: true,
  })
}

async function readStatus(supabase, statusPath) {
  const { data, error } = await supabase.storage.from('maintenance-uploads').download(statusPath)
  if (error || !data) return null
  try {
    return JSON.parse(await data.text())
  } catch {
    return null
  }
}

async function objectExists(supabase, objectPath) {
  const slash = objectPath.lastIndexOf('/')
  const folder = objectPath.slice(0, slash)
  const name = objectPath.slice(slash + 1)
  const { data, error } = await supabase.storage.from('maintenance-uploads').list(folder, { search: name })
  if (error || !Array.isArray(data)) return false
  return data.some((row) => row.name === name)
}

/**
 * Convert one private SMS video to a sibling H.264/AAC mp4.
 * The original object is only read. Retries overwrite the same sibling.
 */
export async function convertStoredSmsVideo(supabase, helpers, input) {
  const {
    playbackSiblingPath,
    playbackStatusPath,
    shouldStartPlaybackJob,
    browserPlaybackFfmpegArgs,
    inputHasAudioStream,
    outputPlaybackCheck,
  } = helpers
  const sourcePath = input.path.trim()
  const playbackPath = playbackSiblingPath(sourcePath)
  const statusPath = playbackStatusPath(sourcePath)
  if (!playbackPath || !statusPath) {
    return { status: 'failed', error: 'That file cannot be converted.' }
  }

  const existing = await readStatus(supabase, statusPath)
  const fileReady = await objectExists(supabase, playbackPath)
  const decision = shouldStartPlaybackJob(existing, fileReady, Date.now())
  if (decision === 'skip-ready') {
    return { status: 'ready', playbackPath, skipped: true }
  }
  if (decision === 'wait') {
    return { status: 'processing', playbackPath }
  }

  await writeStatus(supabase, statusPath, {
    status: 'processing',
    updatedAt: new Date().toISOString(),
  })

  const downloaded = await supabase.storage.from('maintenance-uploads').download(sourcePath)
  if (downloaded.error || !downloaded.data) {
    const error = 'The original video could not be read.'
    await writeStatus(supabase, statusPath, { status: 'failed', error, updatedAt: new Date().toISOString() })
    return { status: 'failed', error }
  }

  const dir = await mkdtemp(join(tmpdir(), 'ulo-playback-'))
  const inputPath = join(dir, 'source.3gp')
  const outputPath = join(dir, 'playback.mp4')
  try {
    const original = Buffer.from(await downloaded.data.arrayBuffer())
    await writeFile(inputPath, original)
    const ffmpeg = input.ffmpegPath || ffmpegBinaryPath()
    const info = await runProcess(ffmpeg, ['-hide_banner', '-i', inputPath], 15000)
    const hasAudio = inputHasAudioStream(`${info.stdout}\n${info.stderr}`)
    const encoded = await runProcess(
      ffmpeg,
      browserPlaybackFfmpegArgs(inputPath, outputPath, hasAudio),
      input.timeoutMs ?? 50000,
    )
    if (encoded.code !== 0) {
      const error = 'The video could not be prepared for playback.'
      await writeStatus(supabase, statusPath, {
        status: 'failed',
        error,
        hasAudio,
        audioPreserved: false,
        updatedAt: new Date().toISOString(),
      })
      return { status: 'failed', error }
    }
    const check = await runProcess(ffmpeg, ['-hide_banner', '-i', outputPath], 15000)
    const verdict = outputPlaybackCheck(`${check.stdout}\n${check.stderr}`, hasAudio)
    if (!verdict.ok) {
      await writeStatus(supabase, statusPath, {
        status: 'failed',
        error: verdict.reason,
        hasAudio,
        audioPreserved: false,
        updatedAt: new Date().toISOString(),
      })
      return { status: 'failed', error: verdict.reason, probe: `${check.stderr}` }
    }
    const mp4 = await readFile(outputPath)
    const uploaded = await supabase.storage.from('maintenance-uploads').upload(playbackPath, mp4, {
      contentType: 'video/mp4',
      upsert: true,
    })
    if (uploaded.error) {
      const error = 'The playable copy could not be saved.'
      await writeStatus(supabase, statusPath, {
        status: 'failed',
        error,
        hasAudio,
        updatedAt: new Date().toISOString(),
      })
      return { status: 'failed', error }
    }
    await writeStatus(supabase, statusPath, {
      status: 'ready',
      hasAudio,
      audioPreserved: hasAudio,
      bytes: mp4.length,
      updatedAt: new Date().toISOString(),
    })
    return {
      status: 'ready',
      playbackPath,
      hasAudio,
      audioPreserved: hasAudio,
      bytes: mp4.length,
      probe: `${check.stderr}`,
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
