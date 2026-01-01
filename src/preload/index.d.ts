/**
 * Type definitions for the preload API.
 * Defines window.electron interface for TypeScript.
 */

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
                resumeBag: (bagId: string) => Promise<{
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
            clearBrowsingData: () => Promise<{
                success: boolean;
                error?: string;
            }>;
            on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
            off: (channel: string) => void;
        };
    }
}
export {};
//# sourceMappingURL=index.d.ts.map