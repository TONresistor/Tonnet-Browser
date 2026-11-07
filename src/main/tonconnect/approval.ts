export interface TonConnectApprovalPort {
  request(content: { type: string; [key: string]: unknown }, signal?: AbortSignal): Promise<boolean>
}
