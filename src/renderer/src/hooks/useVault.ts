import { useState, useEffect, useCallback } from 'react';
import { nexus } from '../utils/nexus';
import type { VaultInfo } from '@shared/vault';

export function useVault() {
  const [currentVault, setCurrentVault] = useState<VaultInfo | null>(null);
  const [recentVaults, setRecentVaults] = useState<VaultInfo[]>([]);

  const refreshRecents = useCallback(async () => {
    const vaults = await nexus.vault.getRecent();
    setRecentVaults(vaults);
  }, []);

  useEffect(() => {
    refreshRecents();
    const unsubOpened = nexus.vault.onOpened((vault) => {
      setCurrentVault(vault);
      refreshRecents();
    });
    const unsubClosed = nexus.vault.onClosed(() => {
      setCurrentVault(null);
    });
    return () => {
      unsubOpened();
      unsubClosed();
    };
  }, [refreshRecents]);

  const openVault = useCallback(async (vault: VaultInfo) => {
    setCurrentVault(vault);
  }, []);

  const closeVault = useCallback(async () => {
    await nexus.vault.close();
    setCurrentVault(null);
    await nexus.settings.save({ lastVaultPath: undefined });
  }, []);

  const safeCopyVault = useCallback(async (sourcePath: string) => {
    return nexus.vault.safeCopy(sourcePath);
  }, []);

  const removeRecentVault = useCallback(async (path: string) => {
    await nexus.vault.removeRecent(path);
    refreshRecents();
  }, [refreshRecents]);

  return {
    currentVault,
    recentVaults,
    openVault,
    closeVault,
    safeCopyVault,
    removeRecentVault,
    refreshRecents,
  };
}