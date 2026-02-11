/// <reference types="vite/client" />
/// <reference types="react" />
/// <reference types="react-dom" />

interface Window {
  electron?: {
    ipcRenderer: {
      invoke(channel: string, ...args: any[]): Promise<any>;
      send(channel: string, ...args: any[]): void;
      on(channel: string, func: (...args: any[]) => void): () => void;
      once(channel: string, func: (...args: any[]) => void): void;
    };
  };
}
