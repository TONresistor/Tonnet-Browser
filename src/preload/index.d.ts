/**
 * Type definitions for the preload API.
 * Defines window.electron interface for TypeScript.
 */

import type { AppSettings } from '../shared/types'

declare global {
    interface Window {
        electron: {
            proxy: {
                connect: () => Promise<{
                    success: boolean;
                    connected?: boolean;
                    port?: number;
                    error?: string;
                }>;
                disconnect: () => Promise<{
                    success: boolean;
                }>;
                status: () => Promise<{
                    connected: boolean;
                    port: number;
                }>;
            };
            tabs: {
                create: (tabId: string) => Promise<{ success: boolean }>;
                close: (tabId: string) => Promise<{ success: boolean }>;
                switch: (tabId: string) => Promise<{ success: boolean }>;
            };
            navigate: (url: string, tabId?: string) => Promise<{
                success: boolean;
                error?: string;
            }>;
            goBack: () => Promise<{
                success: boolean;
            }>;
            goForward: () => Promise<{
                success: boolean;
            }>;
            reload: () => Promise<{
                success: boolean;
            }>;
            stop: () => Promise<{
                success: boolean;
            }>;
            zoomIn: () => Promise<{
                success: boolean;
            }>;
            zoomOut: () => Promise<{
                success: boolean;
            }>;
            zoomReset: () => Promise<{
                success: boolean;
            }>;
            toggleDevTools: () => Promise<{
                success: boolean;
            }>;
            storage: {
                addBag: (bagId: string, name?: string) => Promise<{
                    success: boolean;
                    bag?: unknown;
                    error?: string;
                }>;
                removeBag: (bagId: string) => Promise<{
                    success: boolean;
                }>;
                listBags: () => Promise<{
                    success: boolean;
                    bags: unknown[];
                }>;
                pauseBag: (bagId: string) => Promise<{
                    success: boolean;
                }>;
                getDownloadPath: () => Promise<{
                    success: boolean;
                    path: string;
                }>;
                setDownloadPath: (path: string) => Promise<{
                    success: boolean;
                    error?: string;
                }>;
                selectDownloadFolder: () => Promise<{
                    success: boolean;
                    path?: string;
                    canceled?: boolean;
                    error?: string;
                }>;
                openFolder: (bagId: string) => Promise<{ success: boolean; error?: string }>;
                showFile: (bagId: string, fileName: string) => Promise<{ success: boolean; error?: string }>;
            };
            window: {
                minimize: () => void;
                maximize: () => void;
                close: () => void;
            };
            updateSidebarWidth: (width: number) => Promise<{ success: boolean }>;
            showBookmarkMenu: (id: string, title: string, url: string) => Promise<void>;
            showFolderMenu: (folderId: string, bookmarks: Array<{ id: string; title: string; url: string }>) => Promise<void>;
            showFolderContextMenu: (folderId: string, folderName: string) => Promise<void>;
            view: {
                hide: () => Promise<void>;
                show: () => Promise<void>;
            };
            settings: {
                getAll: () => Promise<AppSettings>;
                get: <K extends keyof AppSettings>(category: K) => Promise<AppSettings[K]>;
                set: (category: string, values: object) => Promise<{ success: boolean; error?: string }>;
                reset: () => Promise<{ success: boolean; error?: string }>;
            };
            clearBrowsingData: () => Promise<{
                success: boolean;
                error?: string;
            }>;
            history: {
                unlock: (password: string) => Promise<{ success: boolean; error?: string }>;
                lock: () => Promise<{ success: boolean }>;
                changeMode: (mode: string, password?: string) => Promise<{ success: boolean; error?: string }>;
                search: (query: string, limit?: number) => Promise<Array<{
                    id: string;
                    url: string;
                    title: string;
                    visitedAt: number;
                    visitCount: number;
                    favicon?: string;
                }>>;
                getRecent: (limit?: number) => Promise<Array<{
                    id: string;
                    url: string;
                    title: string;
                    visitedAt: number;
                    visitCount: number;
                    favicon?: string;
                }>>;
                getTop: (limit?: number) => Promise<Array<{
                    id: string;
                    url: string;
                    title: string;
                    visitedAt: number;
                    visitCount: number;
                    favicon?: string;
                }>>;
                getByDate: (startDate: number, endDate: number) => Promise<Array<{
                    id: string;
                    url: string;
                    title: string;
                    visitedAt: number;
                    visitCount: number;
                    favicon?: string;
                }>>;
                delete: (id: string) => Promise<{ success: boolean; error?: string }>;
                deletePattern: (pattern: string) => Promise<{ success: boolean; count: number; error?: string }>;
                clear: () => Promise<{ success: boolean; error?: string }>;
                getStats: () => Promise<{
                    total: number;
                    mode: string;
                    oldestEntry?: number;
                    newestEntry?: number;
                    isLocked: boolean;
                }>;
            };
            on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
            off: (channel: string) => void;
        };
    }
}
export {};
//# sourceMappingURL=index.d.ts.map