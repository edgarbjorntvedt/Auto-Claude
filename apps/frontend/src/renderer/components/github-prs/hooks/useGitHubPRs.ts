import { useState, useEffect, useCallback } from 'react';
import type {
  PRData,
  PRReviewResult,
  PRReviewProgress
} from '../../../../preload/api/modules/github-api';

// Re-export types for consumers
export type { PRData, PRReviewResult, PRReviewProgress };
export type { PRReviewFinding } from '../../../../preload/api/modules/github-api';

interface UseGitHubPRsResult {
  prs: PRData[];
  isLoading: boolean;
  error: string | null;
  selectedPR: PRData | null;
  selectedPRNumber: number | null;
  reviewResult: PRReviewResult | null;
  reviewProgress: PRReviewProgress | null;
  isReviewing: boolean;
  isConnected: boolean;
  repoFullName: string | null;
  selectPR: (prNumber: number | null) => void;
  refresh: () => Promise<void>;
  runReview: (prNumber: number) => Promise<void>;
  postReview: (prNumber: number) => Promise<boolean>;
}

export function useGitHubPRs(projectId?: string): UseGitHubPRsResult {
  const [prs, setPrs] = useState<PRData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPRNumber, setSelectedPRNumber] = useState<number | null>(null);
  const [reviewResult, setReviewResult] = useState<PRReviewResult | null>(null);
  const [reviewProgress, setReviewProgress] = useState<PRReviewProgress | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [repoFullName, setRepoFullName] = useState<string | null>(null);

  const selectedPR = prs.find(pr => pr.number === selectedPRNumber) || null;

  // Check connection and fetch PRs
  const fetchPRs = useCallback(async () => {
    if (!projectId) return;

    setIsLoading(true);
    setError(null);

    try {
      // First check connection
      const connectionResult = await window.electronAPI.github.checkGitHubConnection(projectId);
      if (connectionResult.success && connectionResult.data) {
        setIsConnected(connectionResult.data.connected);
        setRepoFullName(connectionResult.data.repoFullName || null);

        if (connectionResult.data.connected) {
          // Fetch PRs
          const result = await window.electronAPI.github.listPRs(projectId);
          if (result) {
            setPrs(result);
          }
        }
      } else {
        setIsConnected(false);
        setRepoFullName(null);
        setError(connectionResult.error || 'Failed to check connection');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch PRs');
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchPRs();
  }, [fetchPRs]);

  // Listen for review progress events
  useEffect(() => {
    if (!projectId) return;

    const cleanupProgress = window.electronAPI.github.onPRReviewProgress(
      (pid: string, progress: PRReviewProgress) => {
        if (pid === projectId) {
          setReviewProgress(progress);
        }
      }
    );

    const cleanupComplete = window.electronAPI.github.onPRReviewComplete(
      (pid: string, result: PRReviewResult) => {
        if (pid === projectId) {
          setReviewResult(result);
          setReviewProgress(null);
          setIsReviewing(false);
        }
      }
    );

    const cleanupError = window.electronAPI.github.onPRReviewError(
      (pid: string, data: { prNumber: number; error: string }) => {
        if (pid === projectId) {
          setError(data.error);
          setReviewProgress(null);
          setIsReviewing(false);
        }
      }
    );

    return () => {
      cleanupProgress();
      cleanupComplete();
      cleanupError();
    };
  }, [projectId]);

  const selectPR = useCallback((prNumber: number | null) => {
    setSelectedPRNumber(prNumber);
    setReviewResult(null);

    // Load existing review if available
    if (prNumber && projectId) {
      window.electronAPI.github.getPRReview(projectId, prNumber).then(result => {
        if (result) {
          setReviewResult(result);
        }
      });
    }
  }, [projectId]);

  const refresh = useCallback(async () => {
    await fetchPRs();
  }, [fetchPRs]);

  const runReview = useCallback(async (prNumber: number) => {
    if (!projectId) return;

    setIsReviewing(true);
    setError(null);
    setReviewResult(null);

    window.electronAPI.github.runPRReview(projectId, prNumber);
  }, [projectId]);

  const postReview = useCallback(async (prNumber: number): Promise<boolean> => {
    if (!projectId) return false;

    try {
      return await window.electronAPI.github.postPRReview(projectId, prNumber);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post review');
      return false;
    }
  }, [projectId]);

  return {
    prs,
    isLoading,
    error,
    selectedPR,
    selectedPRNumber,
    reviewResult,
    reviewProgress,
    isReviewing,
    isConnected,
    repoFullName,
    selectPR,
    refresh,
    runReview,
    postReview,
  };
}
