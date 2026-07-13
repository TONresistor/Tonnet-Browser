/** Main-process capabilities owned by the application shell layout. */
export const appShellClient = {
  setTabSidebarWidth: (width: number) => window.electron.updateSidebarWidth(width),
  setContentSidebarWidth: (width: number) => window.electron.updateWalletSidebarWidth(width),
  saveTabSidebarWidth: (width: number) => window.electron.settings.set('appearance', { sidebarWidth: width }),
}
