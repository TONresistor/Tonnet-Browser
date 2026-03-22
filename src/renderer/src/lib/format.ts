export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`
}

export function truncateAddress(addr: string, headLen = 8, tailLen = 6): string {
  if (addr.length <= headLen + tailLen + 3) return addr
  return `${addr.slice(0, headLen)}...${addr.slice(-tailLen)}`
}
