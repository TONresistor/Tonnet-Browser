import { describe, expect, it, vi } from 'vitest'
import { TonConnectManifestLoader, type TonConnectFetchSession } from '../manifest-loader'

function session(response: Response) {
  return { fetch: vi.fn(() => Promise.resolve(response)) } satisfies TonConnectFetchSession
}

describe('TonConnectManifestLoader', () => {
  it('loads and validates a manifest through the originating session', async () => {
    const originSession = session(
      new Response(
        JSON.stringify({
          url: 'https://app.example',
          name: 'Example',
          iconUrl: 'https://app.example/icon.png',
        }),
        { status: 200 }
      )
    )
    const loader = new TonConnectManifestLoader()

    await expect(loader.load(originSession, 'https://app.example/manifest.json')).resolves.toMatchObject({
      name: 'Example',
    })
    expect(originSession.fetch).toHaveBeenCalledWith(
      'https://app.example/manifest.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('rejects non-http URLs before any network operation', async () => {
    const originSession = session(new Response('{}'))
    await expect(new TonConnectManifestLoader().load(originSession, 'file:///etc/passwd')).rejects.toThrow('http(s)')
    expect(originSession.fetch).not.toHaveBeenCalled()
  })

  it('enforces the manifest byte limit from headers and streamed content', async () => {
    const headerLimited = session(
      new Response('{}', { headers: { 'content-length': String(16_385), 'content-type': 'application/json' } })
    )
    await expect(
      new TonConnectManifestLoader().load(headerLimited, 'https://app.example/manifest.json')
    ).rejects.toThrow('Response too large')

    const streamed = session(new Response('x'.repeat(16_385)))
    await expect(new TonConnectManifestLoader().load(streamed, 'https://app.example/manifest.json')).rejects.toThrow(
      'Response too large'
    )
  })

  it('rejects malformed manifest fields at runtime', async () => {
    const originSession = session(new Response(JSON.stringify({ url: 'javascript:alert(1)', name: '' })))
    await expect(
      new TonConnectManifestLoader().load(originSession, 'https://app.example/manifest.json')
    ).rejects.toThrow()
  })

  it('loads bounded raster icons and rejects SVG content', async () => {
    const raster = session(new Response(Buffer.from([1, 2, 3]), { headers: { 'content-type': 'image/png' } }))
    await expect(new TonConnectManifestLoader().loadIcon(raster, 'https://app.example/icon.png')).resolves.toBe(
      'data:image/png;base64,AQID'
    )
    const svg = session(new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }))
    await expect(new TonConnectManifestLoader().loadIcon(svg, 'https://app.example/icon.svg')).resolves.toBeNull()
  })
})
