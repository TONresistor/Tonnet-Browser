import { readFile, stat } from 'node:fs/promises'

const budgets = [
  { file: 'out/preload/index.js', maxBytes: 16 * 1024, owner: 'preload bridge' },
  { file: 'out/main/index.js', maxBytes: 600 * 1024, owner: 'main process' },
]

let failed = false
for (const budget of budgets) {
  let bytes
  try {
    bytes = (await stat(budget.file)).size
  } catch {
    console.error(`Bundle budget failed: ${budget.file} does not exist; run npm run build first.`)
    failed = true
    continue
  }
  const kib = (bytes / 1024).toFixed(2)
  const maxKib = (budget.maxBytes / 1024).toFixed(2)
  if (bytes > budget.maxBytes) {
    console.error(`Bundle budget exceeded for ${budget.owner}: ${kib} KiB > ${maxKib} KiB (${budget.file})`)
    failed = true
  } else {
    console.log(`Bundle budget passed for ${budget.owner}: ${kib} KiB <= ${maxKib} KiB`)
  }
}

try {
  const html = await readFile('out/renderer/index.html', 'utf8')
  const files = [...new Set([...html.matchAll(/(?:src|href)="\.\/(assets\/[^"?]+\.js)/g)].map((match) => match[1]))]
  const sizes = await Promise.all(files.map(async (file) => (await stat(`out/renderer/${file}`)).size))
  const totalBytes = sizes.reduce((total, bytes) => total + bytes, 0)
  const maxBytes = 1.5 * 1024 * 1024
  if (files.length === 0) {
    console.error('Bundle budget failed: renderer initial bundle was not found; run npm run build first.')
    failed = true
  } else if (totalBytes > maxBytes) {
    console.error(
      `Bundle budget exceeded for renderer initial graph: ${(totalBytes / 1024).toFixed(2)} KiB > ${(maxBytes / 1024).toFixed(2)} KiB (${files.join(', ')})`
    )
    failed = true
  } else {
    console.log(
      `Bundle budget passed for renderer initial graph: ${(totalBytes / 1024).toFixed(2)} KiB <= ${(maxBytes / 1024).toFixed(2)} KiB (${files.join(', ')})`
    )
  }
} catch {
  console.error('Bundle budget failed: out/renderer/assets does not exist; run npm run build first.')
  failed = true
}

if (failed) process.exitCode = 1
