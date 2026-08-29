export interface BridgeProvider<T> {
  getBridge(): T | null
  onBridgeChanged(listener: (bridge: T | null) => void): () => void
}

export function mapBridgeProvider<TSource, TPort>(
  source: BridgeProvider<TSource>,
  map: (bridge: TSource) => TPort
): BridgeProvider<TPort> {
  return {
    getBridge: () => {
      const bridge = source.getBridge()
      return bridge === null ? null : map(bridge)
    },
    onBridgeChanged: (listener) => source.onBridgeChanged((bridge) => listener(bridge === null ? null : map(bridge))),
  }
}
