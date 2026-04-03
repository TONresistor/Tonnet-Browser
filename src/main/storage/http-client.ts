/**
 * HTTP Client for tonutils-storage API
 * API Reference: https://github.com/xssnick/tonutils-storage
 */

import type { BagDetails } from '../../shared/types'
import { HTTP_TIMEOUT_MS } from './constants'
import { ERROR_TRUNCATE_LENGTH } from '../../shared/constants'
export type { BagDetails }

export interface BagInfo {
  bag_id: string
  description: string
  downloaded: number
  size: number
  download_speed: number
  upload_speed: number
  files_count: number
  dir_name: string
  completed: boolean
  header_loaded: boolean
  info_loaded: boolean
  active: boolean
  seeding: boolean
  peers: number
}

export interface AddBagRequest {
  bag_id: string
  path?: string
  files?: number[]
  download_all?: boolean
}

export interface RemoveBagRequest {
  bag_id: string
  with_files?: boolean
}

export class StorageHTTPClient {
  private baseUrl: string
  private auth?: { login: string; password: string }

  constructor(host: string, port: number, auth?: { login: string; password: string }) {
    this.baseUrl = `http://${host}:${port}`
    this.auth = auth
  }

  private async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    }

    if (this.auth) {
      const credentials = Buffer.from(`${this.auth.login}:${this.auth.password}`).toString('base64')
      headers['Authorization'] = `Basic ${credentials}`
    }

    const response = await fetch(url, {
      ...options,
      headers,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })

    if (!response.ok) {
      const text = await response.text()
      const truncated = text.length > ERROR_TRUNCATE_LENGTH ? text.substring(0, ERROR_TRUNCATE_LENGTH) + '...' : text
      throw new Error(`HTTP ${response.status}: ${truncated}`)
    }

    const text = await response.text()
    if (!text) return {} as T
    return JSON.parse(text)
  }

  /**
   * List all bags with their status
   */
  async listBags(): Promise<BagInfo[]> {
    const result = await this.fetch<{ bags?: BagInfo[] }>('/api/v1/list')
    return result.bags || []
  }

  /**
   * Get detailed info about a specific bag
   */
  async getBagDetails(bagId: string): Promise<BagDetails> {
    return this.fetch<BagDetails>(`/api/v1/details?bag_id=${encodeURIComponent(bagId)}`)
  }

  /**
   * Add a bag for download
   */
  async addBag(request: AddBagRequest): Promise<{ ok: boolean }> {
    return this.fetch<{ ok: boolean }>('/api/v1/add', {
      method: 'POST',
      body: JSON.stringify({
        bag_id: request.bag_id,
        path: request.path || '',
        files: request.files,
        download_all: request.download_all ?? true,
      }),
    })
  }

  /**
   * Remove a bag
   */
  async removeBag(request: RemoveBagRequest): Promise<{ ok: boolean }> {
    return this.fetch<{ ok: boolean }>('/api/v1/remove', {
      method: 'POST',
      body: JSON.stringify({
        bag_id: request.bag_id,
        with_files: request.with_files ?? false,
      }),
    })
  }

  /**
   * Stop/pause a bag transfer
   */
  async stopBag(bagId: string): Promise<{ ok: boolean }> {
    return this.fetch<{ ok: boolean }>('/api/v1/stop', {
      method: 'POST',
      body: JSON.stringify({ bag_id: bagId }),
    })
  }

  /**
   * Check if the API is reachable
   */
  async ping(): Promise<boolean> {
    try {
      await this.listBags()
      return true
    } catch {
      return false
    }
  }
}
