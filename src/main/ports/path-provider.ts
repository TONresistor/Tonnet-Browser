export interface IPathProvider {
  getUserDataPath(): string
  isPackaged(): boolean
}
