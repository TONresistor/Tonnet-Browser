import { app } from 'electron'
import type { IPathProvider } from '../ports/path-provider'

export class ElectronPathProvider implements IPathProvider {
  getUserDataPath(): string {
    return app.getPath('userData')
  }

  isPackaged(): boolean {
    return app.isPackaged
  }
}
