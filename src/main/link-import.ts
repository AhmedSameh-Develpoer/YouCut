import { spawn, type ChildProcess } from 'node:child_process'
import { lookup } from 'node:dns/promises'
import { access, mkdir, rm, stat } from 'node:fs/promises'
import { join, dirname, resolve, relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import type { LinkImportJob, OpenProject, ProjectCategory } from '../shared/contracts'
import { isLiveMetadata, isPublicAddress, progressFromLine, validateVideoUrl } from './link-import-utils'
import { findFfmpeg } from './video-export'

export type LinkImportRequest = { url: string; projectPath: string; projectId: string; name: string; category: ProjectCategory }

export async function findYtDlp() {
  if (process.env.YT_DLP_PATH) { await access(process.env.YT_DLP_PATH); return process.env.YT_DLP_PATH }
  const packaged = join(process.resourcesPath, 'bin', 'yt-dlp.exe')
  const development = join(process.cwd(), 'build', 'vendor', 'yt-dlp.exe')
  for (const executable of app.isPackaged ? [packaged, development] : [development, packaged]) {
    try { await access(executable); return executable } catch { /* Try the next known location. */ }
  }
  for (const directory of (process.env.PATH || '').split(';').filter(Boolean)) {
    const executable = join(directory, 'yt-dlp.exe')
    try { await access(executable); return executable } catch { /* Check the next PATH entry. */ }
  }
  throw new Error('The video-link importer is missing. Reinstall YouCut or set YT_DLP_PATH to yt-dlp.exe.')
}

function cleanDiagnostic(value: string) {
  return value.replace(/https?:\/\/[^\s"']+/gi, '[video link]').replace(/[\r\n\t]+/g, ' ').slice(-900).trim()
}

function readMetadata(executable: string, url: string, setChild: (child: ChildProcess | null) => void) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(executable, ['--js-runtimes', `node:${process.execPath}`, '--dump-single-json', '--no-playlist', '--no-warnings', '--skip-download', '--', url], { windowsHide: true, shell: false, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    setChild(child)
    let output = '', diagnostic = ''
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill() }, 60_000)
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 4_000_000) child.kill() })
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-3000) })
    child.on('error', () => { clearTimeout(timer); setChild(null); reject(new Error('Could not start the link importer.')) })
    child.on('close', code => {
      clearTimeout(timer)
      setChild(null)
      if (timedOut) { reject(new Error('Checking this video link took too long. Try again.')); return }
      if (code !== 0) { reject(new Error(cleanDiagnostic(diagnostic) || 'This video link could not be read.')); return }
      try { resolve(JSON.parse(output) as Record<string, unknown>) }
      catch { reject(new Error('The source did not return one readable video. Playlists and live streams are not imported.')) }
    })
  })
}

function runDownload(executable: string, ffmpeg: string, url: string, directory: string, setChild: (child: ChildProcess | null) => void, onProgress: (value: number) => void) {
  return new Promise<string>((resolve, reject) => {
    const template = join(directory, '%(title).150B [%(id)s].%(ext)s')
    const args = ['--js-runtimes', `node:${process.execPath}`,'--no-playlist','--newline','--progress','--no-warnings','--restrict-filenames','--format','bv*+ba/b','--merge-output-format','mp4','--ffmpeg-location',ffmpeg,'--output',template,'--print','after_move:filepath','--',url]
    const child = spawn(executable, args, { windowsHide: true, shell: false, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    setChild(child)
    let stdout = '', pending = '', diagnostic = ''
    let timedOut = false
    let timer: ReturnType<typeof setTimeout>
    const refreshTimeout = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; child.kill() }, 120_000) }
    refreshTimeout()
    child.stdout.on('data', chunk => { refreshTimeout(); stdout += chunk; if (stdout.length > 200_000) stdout = stdout.slice(-200_000) })
    child.stderr.on('data', chunk => {
      refreshTimeout()
      diagnostic = (diagnostic + chunk).slice(-6000)
      pending += chunk.toString()
      const lines = pending.split(/\r?\n/); pending = lines.pop() || ''
      for (const line of lines) { const progress = progressFromLine(line); if (progress !== null) onProgress(progress) }
    })
    child.on('error', () => { clearTimeout(timer); setChild(null); reject(new Error('Could not start the link importer.')) })
    child.on('close', code => {
      setChild(null)
      if (timedOut) { reject(new Error('The download stopped responding. Check your connection and try again.')); return }
      clearTimeout(timer)
      if (code !== 0) { reject(new Error(cleanDiagnostic(diagnostic) || 'The video could not be downloaded. Check that the link is public and try again.')); return }
      const outputPath = stdout.split(/\r?\n/).map(line => line.trim()).filter(line => line && line.toLowerCase() !== 'na').at(-1)
      if (!outputPath) { reject(new Error('The download finished without returning a video file.')); return }
      resolve(outputPath)
    })
  })
}

export class LinkImportRunner {
  job: LinkImportJob | null = null
  private child: ChildProcess | null = null
  private cancelled = false
  private downloadDirectory: string | null = null

  start(request: LinkImportRequest, complete: (path: string, projectId: string) => Promise<OpenProject>) {
    if (this.job?.status === 'running') throw new Error('A link import is already running.')
    const url = validateVideoUrl(request.url)
    this.cancelled = false
    const job: LinkImportJob = { id: randomUUID(), status: 'running', stage: 'checking', progress: 0, message: 'Checking video link…' }
    this.job = job
    void this.run(job, { ...request, url }, complete)
    return { ...job }
  }

  private async run(job: LinkImportJob, request: LinkImportRequest, complete: (path: string, projectId: string) => Promise<OpenProject>) {
    const projectData = join(dirname(request.projectPath), `${request.projectId}.youcut-data`)
    const downloadDirectory = join(projectData, 'downloads')
    this.downloadDirectory = projectData
    try {
      const [executable, ffmpeg] = await Promise.all([findYtDlp(), findFfmpeg()])
      if (this.cancelled) return
      let addresses: Array<{ address: string; family: number }>
      try { addresses = await lookup(new URL(request.url).hostname, { all: true, verbatim: true }) }
      catch { throw new Error('The video site could not be reached. Check your internet connection and link.') }
      if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('Local and private network links are not supported.')
      if (this.cancelled) return
      await mkdir(downloadDirectory, { recursive: true })
      if (this.cancelled) return
      const metadata = await readMetadata(executable, request.url, child => { this.child = child })
      if (this.cancelled) return
      if (isLiveMetadata(metadata)) throw new Error('Live streams are not supported. Use a completed video or VOD link.')
      job.stage = 'downloading'; job.message = typeof metadata.title === 'string' ? `Downloading: ${metadata.title.slice(0, 140)}` : 'Downloading video…'
      const output = await runDownload(executable, ffmpeg, request.url, downloadDirectory, child => { this.child = child }, progress => { if (!this.cancelled) job.progress = progress })
      if (this.cancelled) return
      const pathFromDirectory = relative(resolve(downloadDirectory), resolve(output))
      if (!pathFromDirectory || pathFromDirectory === '..' || pathFromDirectory.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(pathFromDirectory)) throw new Error('The importer returned a file outside the project downloads folder.')
      const details = await stat(output)
      if (!details.isFile() || details.size < 1024) throw new Error('The downloaded source file is empty or invalid.')
      job.stage = 'saving'; job.progress = 1; job.message = 'Saving the local project…'
      job.opened = await complete(output, request.projectId)
      if (this.cancelled) return
      job.stage = 'complete'; job.status = 'complete'; job.message = 'Video imported and project saved.'
    } catch (error) {
      if (this.cancelled) {
        job.status = 'cancelled'; job.message = 'Import cancelled.'
        await rm(projectData, { recursive: true, force: true }).catch(() => {})
        return
      }
      job.status = 'error'; job.message = 'The link could not be imported.'
      job.error = error instanceof Error ? cleanDiagnostic(error.message) : 'The video could not be imported.'
      await rm(projectData, { recursive: true, force: true }).catch(() => {})
    } finally {
      this.child = null
      this.downloadDirectory = null
      if (this.cancelled && job.status === 'running') {
        job.status = 'cancelled'; job.message = 'Import cancelled.'
        await rm(projectData, { recursive: true, force: true }).catch(() => {})
      }
    }
  }

  snapshot() { return this.job ? { ...this.job } : null }

  cancel() {
    if (this.job?.status === 'running' && this.job.stage !== 'saving') {
      this.cancelled = true
      this.child?.kill()
      if (!this.child && this.downloadDirectory) void rm(this.downloadDirectory, { recursive: true, force: true })
    }
  }
}
