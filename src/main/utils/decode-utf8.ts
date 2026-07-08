import { StringDecoder } from 'node:string_decoder'

/**
 * Decode a (possibly truncated) UTF-8 buffer, dropping an incomplete trailing
 * multibyte sequence instead of emitting a broken/replacement character. Used
 * when a file is read up to a byte cap that may fall mid-codepoint.
 */
export function decodeUtf8Prefix(buf: Buffer): string {
  // write() returns all complete characters and internally buffers any
  // incomplete trailing bytes; not calling end() drops them (the rest of the
  // truncated file is gone anyway).
  return new StringDecoder('utf8').write(buf)
}
