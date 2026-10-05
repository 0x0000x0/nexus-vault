import type { NexusAPI } from '../../preload/index.js';

declare global {
  interface Window {
    nexus: NexusAPI;
  }
}

export const nexus = window.nexus;