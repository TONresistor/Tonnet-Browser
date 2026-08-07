export class ProxyAutoConnector {
  private flight: Promise<void> | null = null

  constructor(
    private readonly start: () => Promise<void>,
    private readonly isRunning: () => boolean
  ) {}

  connect(): Promise<void> {
    if (this.flight) return this.flight
    if (this.isRunning()) return Promise.resolve()

    const flight = Promise.resolve().then(() => this.start())
    this.flight = flight
    flight.then(
      () => {
        if (this.flight === flight) this.flight = null
      },
      () => {
        if (this.flight === flight) this.flight = null
      }
    )
    return flight
  }
}
