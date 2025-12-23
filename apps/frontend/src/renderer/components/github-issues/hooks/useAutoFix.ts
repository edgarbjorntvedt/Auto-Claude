import { useState, useEffect, useCallback } from 'react';
import type { AutoFixConfig, AutoFixQueueItem } from '../../../../preload/api/modules/github-api';

/**
 * Hook for managing auto-fix state
 */
export function useAutoFix(projectId: string | undefined) {
  const [config, setConfig] = useState<AutoFixConfig | null>(null);
  const [queue, setQueue] = useState<AutoFixQueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Load config and queue
  const loadData = useCallback(async () => {
    if (!projectId) return;

    setIsLoading(true);
    try {
      const [configResult, queueResult] = await Promise.all([
        window.electronAPI.github.getAutoFixConfig(projectId),
        window.electronAPI.github.getAutoFixQueue(projectId),
      ]);

      setConfig(configResult);
      setQueue(queueResult);
    } catch (error) {
      console.error('Failed to load auto-fix data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  // Load on mount and when projectId changes
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Listen for completion events to refresh queue
  useEffect(() => {
    if (!projectId) return;

    const cleanup = window.electronAPI.github.onAutoFixComplete(
      (eventProjectId: string) => {
        if (eventProjectId === projectId) {
          // Refresh the queue when an item completes
          window.electronAPI.github.getAutoFixQueue(projectId).then(setQueue);
        }
      }
    );

    return cleanup;
  }, [projectId]);

  // Get queue item for a specific issue
  const getQueueItem = useCallback(
    (issueNumber: number): AutoFixQueueItem | null => {
      return queue.find(item => item.issueNumber === issueNumber) || null;
    },
    [queue]
  );

  // Save config
  const saveConfig = useCallback(
    async (newConfig: AutoFixConfig): Promise<boolean> => {
      if (!projectId) return false;

      try {
        const success = await window.electronAPI.github.saveAutoFixConfig(projectId, newConfig);
        if (success) {
          setConfig(newConfig);
        }
        return success;
      } catch (error) {
        console.error('Failed to save auto-fix config:', error);
        return false;
      }
    },
    [projectId]
  );

  return {
    config,
    queue,
    isLoading,
    getQueueItem,
    saveConfig,
    refresh: loadData,
  };
}
