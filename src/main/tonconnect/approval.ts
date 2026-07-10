export interface TonConnectApprovalPort {
  request(content: { type: string; [key: string]: unknown }): Promise<boolean>
}
