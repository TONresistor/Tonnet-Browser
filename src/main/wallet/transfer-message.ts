import { internal, type MessageRelaxed } from '@ton/core'
import { encodeCommentBody, normalizeComment } from './comment'
import { parseTransferTarget } from './address-utils'

export function createTonTransferMessage(
  to: string,
  amount: string,
  comment?: string
): { message: MessageRelaxed; bounce: boolean; comment?: string } {
  const normalizedComment = normalizeComment(comment)
  const target = parseTransferTarget(to)
  return {
    message: internal({
      to: target.address,
      value: BigInt(amount),
      bounce: target.bounce,
      body: normalizedComment ? encodeCommentBody(normalizedComment) : undefined,
    }),
    bounce: target.bounce,
    comment: normalizedComment,
  }
}
