export class UnsupportedSchemaVersionError extends Error {
  constructor(
    readonly storedVersion: number,
    readonly supportedVersion: number,
    readonly filePath: string
  ) {
    super(`Unsupported schema version ${storedVersion} for ${filePath}; maximum supported is ${supportedVersion}`)
    this.name = 'UnsupportedSchemaVersionError'
  }
}

export function assertSupportedSchemaVersion(stored: number, supported: number, filePath: string): void {
  if (stored > supported) throw new UnsupportedSchemaVersionError(stored, supported, filePath)
}
