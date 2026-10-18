import { isIP } from 'node:net'

export function isPublicAddress(host: string) {
  const value = host.toLowerCase().replace(/^\[|\]$/g, '')
  const version = isIP(value)
  if (version === 4) {
    const parts = value.split('.').map(Number)
    const [a,b,c] = parts
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2) || (a === 192 && b === 88 && c === 99) || (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) || (a === 203 && b === 0 && c === 113)) return false
    return true
  }
  if (version === 6) {
    if (value === '::' || value === '::1' || value.startsWith('::ffff:') || /^f[cd]/i.test(value) || /^fe[89ab]/i.test(value) || value.startsWith('2001:db8:')) return false
    return /^2[0-9a-f]{3}:/i.test(value)
  }
  return value !== 'localhost' && !value.endsWith('.localhost') && !value.endsWith('.local') && !value.endsWith('.internal')
}

export function validateVideoUrl(value: string) {
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('Enter a complete video link.') }
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Use a public HTTP or HTTPS video link without embedded credentials.')
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!isPublicAddress(host)) throw new Error('Local and private network links are not supported.')
  url.hash = ''
  return url.toString()
}

export function progressFromLine(line: string) {
  const match = /^\[download\]\s+(\d+(?:\.\d+)?)%/.exec(line.trim())
  if (!match) return null
  const value = Number(match[1]) / 100
  return Number.isFinite(value) ? Math.max(0, Math.min(.99, value)) : null
}

export function isLiveMetadata(value: unknown) {
  if (!value || typeof value !== 'object') return false
  const data = value as { is_live?: unknown; live_status?: unknown }
  return data.is_live === true || data.live_status === 'is_live' || data.live_status === 'is_upcoming'
}
