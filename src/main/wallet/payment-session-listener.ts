import { normalizePaymentOrigin } from './payment-policy'
import type { InterceptedRequest } from './payment-interceptor-types'

export function registerPaymentSessionListener(
  session: Electron.Session,
  handle402: (request: InterceptedRequest) => Promise<void>
): void {
  const navigationOrigins = new Map<number, string>()
  const httpUrls = ['http://*/*', 'https://*/*']
  session.webRequest.onBeforeRequest({ urls: httpUrls }, (details, callback) => {
    if (
      details.resourceType === 'mainFrame' &&
      details.webContentsId != null &&
      !navigationOrigins.has(details.webContentsId)
    ) {
      navigationOrigins.set(details.webContentsId, normalizePaymentOrigin(details.url))
    }
    callback({})
  })
  session.webRequest.onErrorOccurred({ urls: httpUrls }, (details) => {
    if (details.resourceType === 'mainFrame' && details.webContentsId != null) {
      navigationOrigins.delete(details.webContentsId)
    }
  })
  session.webRequest.onCompleted({ urls: httpUrls }, (details) => {
    if (details.resourceType !== 'mainFrame' || details.webContentsId == null) return
    const originalOrigin = navigationOrigins.get(details.webContentsId)
    navigationOrigins.delete(details.webContentsId)
    if (details.statusCode !== 402) return
    void handle402({
      url: details.url,
      originalOrigin,
      webContentsId: details.webContentsId,
      session,
    })
  })
}
