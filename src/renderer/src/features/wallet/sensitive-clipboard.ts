export async function copySensitiveText(value: string, clearAfterMs = 30_000): Promise<void> {
  await navigator.clipboard.writeText(value)
  setTimeout(async () => {
    try {
      if ((await navigator.clipboard.readText()) === value) await navigator.clipboard.writeText('')
    } catch {
      return
    }
  }, clearAfterMs)
}
