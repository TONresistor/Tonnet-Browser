export const tonConnectClient = {
  getSessions: () => window.electron.tonconnect.getSessions(),
  disconnectSession: (domain: string) => window.electron.tonconnect.disconnectSession(domain),
}
