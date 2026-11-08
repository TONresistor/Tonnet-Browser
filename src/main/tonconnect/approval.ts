export interface TonConnectApprovalPort {
  request(content: { type: string; [key: string]: unknown }, signal?: AbortSignal): Promise<boolean>
  requestUnlock(domain: string, unlock: (password: string) => Promise<boolean>, signal?: AbortSignal): Promise<boolean>
}
