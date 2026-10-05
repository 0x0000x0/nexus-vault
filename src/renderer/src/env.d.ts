import type { NexusApi } from '../../shared/api';
declare global {
  interface Window {
    nexus: NexusApi;
  }
  const __APP_VERSION__: string;
}
export {};
