import { useState, useEffect, useCallback } from 'react';
import { nexus } from '../utils/nexus';
import type { LayoutSettings } from '@shared/settings';

const DEFAULT_LAYOUT: LayoutSettings = {
  treeWidth: 240,
  toolStripExpanded: true,
  paneRatio: 0.44,
  paneOrder: 'board-graph',
  view: 'split',
};

export function useLayout() {
  const [layout, setLayoutState] = useState<LayoutSettings & { expandPaths?: string[]; maximizedPane?: 'graph' | 'board' | null }>({
    ...DEFAULT_LAYOUT,
    expandPaths: [],
    maximizedPane: null,
  });

  useEffect(() => {
    nexus.settings.get().then((settings) => {
      if (settings.layout) {
        setLayoutState((prev) => ({ ...prev, ...settings.layout }));
      }
    });
  }, []);

  const setLayout = useCallback(async (partial: Partial<LayoutSettings & { expandPaths?: string[]; maximizedPane?: 'graph' | 'board' | null }>) => {
    setLayoutState((prev) => {
      const next = { ...prev, ...partial };
      nexus.settings.save({ layout: next });
      return next;
    });
  }, []);

  const resetDivider = useCallback(() => {
    setLayout({ treeWidth: DEFAULT_LAYOUT.treeWidth, paneRatio: DEFAULT_LAYOUT.paneRatio, toolStripExpanded: DEFAULT_LAYOUT.toolStripExpanded });
  }, [setLayout]);

  return { layout, setLayout, resetDivider };
}