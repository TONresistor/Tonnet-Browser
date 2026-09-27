export const zkResistorClient = {
  resourceStatus: () => window.electron.zkresistor.resourceStatus(),
  prepareResources: () => window.electron.zkresistor.prepareResources(),
  catalog: () => window.electron.zkresistor.catalog(),
  account: (...args: Parameters<typeof window.electron.zkresistor.account>) =>
    window.electron.zkresistor.account(...args),
  merkle: (...args: Parameters<typeof window.electron.zkresistor.merkle>) => window.electron.zkresistor.merkle(...args),
  resource: (...args: Parameters<typeof window.electron.zkresistor.resource>) =>
    window.electron.zkresistor.resource(...args),
  send: (...args: Parameters<typeof window.electron.zkresistor.send>) => window.electron.zkresistor.send(...args),
}
