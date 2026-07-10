export const dnsClient = {
  resolve: (domain: string) => window.electron.dns.resolve(domain),
}
