import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { safeStorage, type BrowserWindow } from 'electron'

interface Context {
  window: BrowserWindow
  profile: string
  phase: string
  pass: (message: string) => void
}

interface WalletView {
  isCreated: boolean
  isLocked: boolean
  backupVerified: boolean
  address: string
}

/** Uses only the generated wallet in the validated disposable package profile. */
export async function runWalletScenario({ window, profile, phase, pass }: Context): Promise<void> {
  if (process.platform === 'linux') {
    assert.equal(safeStorage.getSelectedStorageBackend(), 'gnome_libsecret', 'Wallet test requires GNOME Keyring')
    assert(safeStorage.isEncryptionAvailable(), 'Wallet test requires an unlocked keyring')
  }
  const password = 'packaged-wallet-test-password'
  const expectedPath = join(profile, 'wallet-test-expected.json')
  const evaluate = <T>(script: string): Promise<T> => window.webContents.executeJavaScript(script, true)
  const snapshot = (): Promise<WalletView> => evaluate('window.electron.wallet.getSnapshot()')
  const until = async (check: () => Promise<boolean>, label: string) => {
    const deadline = Date.now() + 30_000
    while (!(await check())) {
      assert(Date.now() < deadline, `Wallet test timed out: ${label}`)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  const click = async (label: string) => {
    await until(
      () =>
        evaluate(
          `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled)`
        ),
      `button ${label}`
    )
    assert(
      await evaluate(
        `(() => { const button = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled); if (!button) return false; button.click(); return true })()`
      ),
      `Wallet button unavailable: ${label}`
    )
  }
  const fill = async (placeholder: string, value: string) => {
    assert(
      await evaluate(
        `(() => { const input = Array.from(document.querySelectorAll('input')).find(i => i.placeholder === ${JSON.stringify(placeholder)}); if (!input) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`
      ),
      `Wallet input unavailable: ${placeholder}`
    )
  }

  await evaluate(`(() => {
    const input = document.getElementById('address-bar-input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'ton://wallet');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 50))
  await evaluate("document.getElementById('address-bar-input').closest('form').requestSubmit()")
  await until(() => evaluate("document.getElementById('address-bar-input')?.value === 'ton://wallet'"), 'wallet route')

  if (phase === 'wallet-create') {
    await until(
      () => evaluate('Boolean(document.querySelector(\'input[placeholder="Confirm wallet password"]\'))'),
      'wallet creation'
    )
    assert.equal((await snapshot()).isCreated, false, 'Disposable profile already has a wallet')
    await fill('Wallet password', password)
    await fill('Confirm wallet password', password)
    await click('Create Wallet')
    await click('Show Recovery Phrase')
    await until(
      () =>
        evaluate(
          "Array.from(document.querySelectorAll('div.grid.grid-cols-3 > div'), row => row.querySelector('span:last-child')?.textContent?.trim() ?? '').every(word => /^[a-z]+$/.test(word)) && document.querySelectorAll('div.grid.grid-cols-3 > div').length === 24"
        ),
      'revealed recovery phrase'
    )
    const words = await evaluate<string[]>(
      "Array.from(document.querySelectorAll('div.grid.grid-cols-3 > div'), row => row.querySelector('span:last-child')?.textContent?.trim() ?? '')"
    )
    try {
      assert.equal(words.length, 24, 'Recovery phrase must contain 24 words')
      assert(
        words.every((word) => /^[a-z]+$/.test(word)),
        'Recovery phrase was not revealed'
      )
      assert(
        await evaluate(
          "(() => { const input = document.querySelector('input[type=checkbox]'); if (!input || input.disabled) return false; input.click(); return true })()"
        ),
        'Backup acknowledgement unavailable'
      )
      await click('I saved it — continue')
      await until(
        () => evaluate('document.querySelectorAll(\'input[placeholder^="Word #"]\').length > 0'),
        'backup challenge'
      )
      const indexes = await evaluate<number[]>(
        'Array.from(document.querySelectorAll(\'input[placeholder^="Word #"]\'), input => Number(input.placeholder.match(/\\d+/)?.[0]))'
      )
      assert(
        indexes.length > 0 && indexes.every((index) => Number.isInteger(index) && index >= 1 && index <= words.length)
      )
      for (const index of indexes) await fill(`Word #${index}`, words[index - 1])
      await click('Verify backup')
      await until(async () => {
        const state = await snapshot()
        return state.isCreated && state.backupVerified && !state.isLocked && Boolean(state.address)
      }, 'verified wallet')
    } finally {
      words.fill('')
    }
    const created = await snapshot()
    assert(created.address, 'Created wallet address missing')
    await writeFile(expectedPath, JSON.stringify({ address: created.address }), { mode: 0o600 })
    await until(
      () => evaluate('Boolean(document.querySelector(\'button[aria-label="Lock wallet"]\'))'),
      'wallet lock button'
    )
    assert(
      await evaluate(
        '(() => { const button = document.querySelector(\'button[aria-label="Lock wallet"]\'); if (!button) return false; button.click(); return true })()'
      ),
      'Wallet lock button unavailable'
    )
    await until(async () => (await snapshot()).isLocked, 'wallet lock')
    pass('wallet: generated wallet backup verified and locked before restart')
    return
  }

  assert.equal(phase, 'wallet-resume', 'Invalid wallet test phase')
  const expected = JSON.parse(await readFile(expectedPath, 'utf8')) as { address: string }
  const initial = await snapshot()
  assert(initial.isCreated && initial.isLocked, 'Wallet did not restart locked')
  assert.equal(initial.address, expected.address, 'Wallet identity changed after restart')
  await until(
    () => evaluate('Boolean(document.querySelector(\'input[placeholder="Wallet password"]\'))'),
    'wallet unlock'
  )
  await fill('Wallet password', password)
  await click('Unlock')
  await until(async () => {
    const state = await snapshot()
    return !state.isLocked && state.backupVerified && state.address === expected.address
  }, 'wallet unlocked after restart')
  await until(
    () =>
      evaluate(
        `Boolean(Array.from(document.querySelectorAll('button[title]')).find(b => b.title === ${JSON.stringify(expected.address)}))`
      ),
    'restored address rendered'
  )
  pass('wallet: locked restart and unlock restored the same address')
}
