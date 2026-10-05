import type { NexusApi } from '../../shared/api';
declare global {
  interface Window {
    nexus: NexusApi;
  }
}
export {};
