export const aboutClient = {
  checkForUpdates: () => window.electron.updater.check(),
  openDownloadPage: () => window.electron.updater.openDownloadPage(),
  versions: () => window.electron.versions,
}
