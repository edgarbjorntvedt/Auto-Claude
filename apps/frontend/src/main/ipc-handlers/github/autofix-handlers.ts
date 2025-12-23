/**
 * GitHub Auto-Fix IPC handlers
 *
 * Handles automatic fixing of GitHub issues by:
 * 1. Detecting issues with configured labels (e.g., "auto-fix")
 * 2. Creating specs from issues
 * 3. Running the build pipeline
 * 4. Creating PRs when complete
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { IPC_CHANNELS } from '../../../shared/constants';
import { projectStore } from '../../project-store';
import { getGitHubConfig, githubFetch } from './utils';
import { createSpecForIssue, buildIssueContext, buildInvestigationTask } from './spec-utils';
import type { Project } from '../../../shared/types';

// Debug logging helper
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    if (data !== undefined) {
      console.warn(`[GitHub AutoFix] ${message}`, data);
    } else {
      console.warn(`[GitHub AutoFix] ${message}`);
    }
  }
}

/**
 * Auto-fix configuration stored in .auto-claude/github/config.json
 */
export interface AutoFixConfig {
  enabled: boolean;
  labels: string[];
  requireHumanApproval: boolean;
  botToken?: string;
  model: string;
  thinkingLevel: string;
}

/**
 * Auto-fix queue item
 */
export interface AutoFixQueueItem {
  issueNumber: number;
  repo: string;
  status: 'pending' | 'analyzing' | 'creating_spec' | 'building' | 'qa_review' | 'pr_created' | 'completed' | 'failed';
  specId?: string;
  prNumber?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Progress status for auto-fix operations
 */
export interface AutoFixProgress {
  phase: 'checking' | 'fetching' | 'analyzing' | 'creating_spec' | 'building' | 'qa_review' | 'creating_pr' | 'complete';
  issueNumber: number;
  progress: number;
  message: string;
}

/**
 * Get the GitHub directory for a project
 */
function getGitHubDir(project: Project): string {
  return path.join(project.path, '.auto-claude', 'github');
}

/**
 * Get the auto-fix config for a project
 */
function getAutoFixConfig(project: Project): AutoFixConfig {
  const configPath = path.join(getGitHubDir(project), 'config.json');

  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return {
        enabled: data.auto_fix_enabled ?? false,
        labels: data.auto_fix_labels ?? ['auto-fix'],
        requireHumanApproval: data.require_human_approval ?? true,
        botToken: data.bot_token,
        model: data.model ?? 'claude-sonnet-4-20250514',
        thinkingLevel: data.thinking_level ?? 'medium',
      };
    } catch {
      // Return defaults
    }
  }

  return {
    enabled: false,
    labels: ['auto-fix'],
    requireHumanApproval: true,
    model: 'claude-sonnet-4-20250514',
    thinkingLevel: 'medium',
  };
}

/**
 * Save the auto-fix config for a project
 */
function saveAutoFixConfig(project: Project, config: AutoFixConfig): void {
  const githubDir = getGitHubDir(project);
  fs.mkdirSync(githubDir, { recursive: true });

  const configPath = path.join(githubDir, 'config.json');
  let existingConfig: Record<string, unknown> = {};

  if (fs.existsSync(configPath)) {
    try {
      existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      // Use empty config
    }
  }

  const updatedConfig = {
    ...existingConfig,
    auto_fix_enabled: config.enabled,
    auto_fix_labels: config.labels,
    require_human_approval: config.requireHumanApproval,
    bot_token: config.botToken,
    model: config.model,
    thinking_level: config.thinkingLevel,
  };

  fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2));
}

/**
 * Get the auto-fix queue for a project
 */
function getAutoFixQueue(project: Project): AutoFixQueueItem[] {
  const issuesDir = path.join(getGitHubDir(project), 'issues');

  if (!fs.existsSync(issuesDir)) {
    return [];
  }

  const queue: AutoFixQueueItem[] = [];
  const files = fs.readdirSync(issuesDir);

  for (const file of files) {
    if (file.startsWith('autofix_') && file.endsWith('.json')) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(issuesDir, file), 'utf-8'));
        queue.push({
          issueNumber: data.issue_number,
          repo: data.repo,
          status: data.status,
          specId: data.spec_id,
          prNumber: data.pr_number,
          error: data.error,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        });
      } catch {
        // Skip invalid files
      }
    }
  }

  return queue.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Send progress update to renderer
 */
function sendProgress(
  mainWindow: BrowserWindow,
  projectId: string,
  status: AutoFixProgress
): void {
  mainWindow.webContents.send(
    IPC_CHANNELS.GITHUB_AUTOFIX_PROGRESS,
    projectId,
    status
  );
}

/**
 * Send error to renderer
 */
function sendError(
  mainWindow: BrowserWindow,
  projectId: string,
  issueNumber: number,
  error: string
): void {
  mainWindow.webContents.send(
    IPC_CHANNELS.GITHUB_AUTOFIX_ERROR,
    projectId,
    { issueNumber, error }
  );
}

/**
 * Send completion to renderer
 */
function sendComplete(
  mainWindow: BrowserWindow,
  projectId: string,
  result: AutoFixQueueItem
): void {
  mainWindow.webContents.send(
    IPC_CHANNELS.GITHUB_AUTOFIX_COMPLETE,
    projectId,
    result
  );
}

/**
 * Check for issues with auto-fix labels
 */
async function checkAutoFixLabels(project: Project): Promise<number[]> {
  const config = getAutoFixConfig(project);
  if (!config.enabled || config.labels.length === 0) {
    return [];
  }

  const ghConfig = getGitHubConfig(project);
  if (!ghConfig) {
    return [];
  }

  // Fetch open issues
  const issues = await githubFetch(
    ghConfig.token,
    `/repos/${ghConfig.repo}/issues?state=open&per_page=100`
  ) as Array<{
    number: number;
    labels: Array<{ name: string }>;
    pull_request?: unknown;
  }>;

  // Filter for issues (not PRs) with matching labels
  const queue = getAutoFixQueue(project);
  const pendingIssues = new Set(queue.map(q => q.issueNumber));

  const matchingIssues: number[] = [];

  for (const issue of issues) {
    // Skip pull requests
    if (issue.pull_request) continue;

    // Skip already in queue
    if (pendingIssues.has(issue.number)) continue;

    // Check for matching labels
    const issueLabels = issue.labels.map(l => l.name.toLowerCase());
    const hasMatchingLabel = config.labels.some(
      label => issueLabels.includes(label.toLowerCase())
    );

    if (hasMatchingLabel) {
      matchingIssues.push(issue.number);
    }
  }

  return matchingIssues;
}

/**
 * Start auto-fix for an issue
 */
async function startAutoFix(
  project: Project,
  issueNumber: number,
  mainWindow: BrowserWindow
): Promise<void> {
  const ghConfig = getGitHubConfig(project);
  if (!ghConfig) {
    throw new Error('No GitHub configuration found');
  }

  const config = getAutoFixConfig(project);

  sendProgress(mainWindow, project.id, {
    phase: 'fetching',
    issueNumber,
    progress: 10,
    message: `Fetching issue #${issueNumber}...`,
  });

  // Fetch the issue
  const issue = await githubFetch(
    ghConfig.token,
    `/repos/${ghConfig.repo}/issues/${issueNumber}`
  ) as {
    number: number;
    title: string;
    body?: string;
    labels: Array<{ name: string }>;
    html_url: string;
  };

  // Fetch comments
  const comments = await githubFetch(
    ghConfig.token,
    `/repos/${ghConfig.repo}/issues/${issueNumber}/comments`
  ) as Array<{ id: number; body: string; user: { login: string } }>;

  sendProgress(mainWindow, project.id, {
    phase: 'analyzing',
    issueNumber,
    progress: 30,
    message: 'Analyzing issue...',
  });

  // Build context
  const labels = issue.labels.map(l => l.name);
  const issueContext = buildIssueContext(
    issue.number,
    issue.title,
    issue.body,
    labels,
    issue.html_url,
    comments.map(c => ({
      id: c.id,
      body: c.body,
      user: { login: c.user.login },
      created_at: '',
      html_url: '',
    }))
  );

  sendProgress(mainWindow, project.id, {
    phase: 'creating_spec',
    issueNumber,
    progress: 50,
    message: 'Creating spec from issue...',
  });

  // Create spec
  const taskDescription = buildInvestigationTask(
    issue.number,
    issue.title,
    issueContext
  );

  const specData = await createSpecForIssue(
    project,
    issue.number,
    issue.title,
    taskDescription,
    issue.html_url,
    labels
  );

  // Save auto-fix state
  const issuesDir = path.join(getGitHubDir(project), 'issues');
  fs.mkdirSync(issuesDir, { recursive: true });

  const state: AutoFixQueueItem = {
    issueNumber,
    repo: ghConfig.repo,
    status: 'creating_spec',
    specId: specData.specId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(issuesDir, `autofix_${issueNumber}.json`),
    JSON.stringify({
      issue_number: state.issueNumber,
      repo: state.repo,
      status: state.status,
      spec_id: state.specId,
      created_at: state.createdAt,
      updated_at: state.updatedAt,
    }, null, 2)
  );

  sendProgress(mainWindow, project.id, {
    phase: 'complete',
    issueNumber,
    progress: 100,
    message: 'Spec created. Ready to start build.',
  });

  sendComplete(mainWindow, project.id, state);
}

/**
 * Register auto-fix related handlers
 */
export function registerAutoFixHandlers(
  getMainWindow: () => BrowserWindow | null
): void {
  debugLog('Registering AutoFix handlers');

  // Get auto-fix config
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_AUTOFIX_GET_CONFIG,
    async (_, projectId: string): Promise<AutoFixConfig | null> => {
      debugLog('getAutoFixConfig handler called', { projectId });
      const project = projectStore.getProject(projectId);
      if (!project) {
        debugLog('Project not found', { projectId });
        return null;
      }
      const config = getAutoFixConfig(project);
      debugLog('AutoFix config loaded', { enabled: config.enabled, labels: config.labels });
      return config;
    }
  );

  // Save auto-fix config
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_AUTOFIX_SAVE_CONFIG,
    async (_, projectId: string, config: AutoFixConfig): Promise<boolean> => {
      debugLog('saveAutoFixConfig handler called', { projectId, enabled: config.enabled });
      const project = projectStore.getProject(projectId);
      if (!project) {
        debugLog('Project not found', { projectId });
        return false;
      }
      saveAutoFixConfig(project, config);
      debugLog('AutoFix config saved');
      return true;
    }
  );

  // Get auto-fix queue
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_AUTOFIX_GET_QUEUE,
    async (_, projectId: string): Promise<AutoFixQueueItem[]> => {
      debugLog('getAutoFixQueue handler called', { projectId });
      const project = projectStore.getProject(projectId);
      if (!project) {
        debugLog('Project not found', { projectId });
        return [];
      }
      const queue = getAutoFixQueue(project);
      debugLog('AutoFix queue loaded', { count: queue.length });
      return queue;
    }
  );

  // Check for issues with auto-fix labels
  ipcMain.handle(
    IPC_CHANNELS.GITHUB_AUTOFIX_CHECK_LABELS,
    async (_, projectId: string): Promise<number[]> => {
      debugLog('checkAutoFixLabels handler called', { projectId });
      const project = projectStore.getProject(projectId);
      if (!project) {
        debugLog('Project not found', { projectId });
        return [];
      }
      const issues = await checkAutoFixLabels(project);
      debugLog('Issues with auto-fix labels', { count: issues.length, issues });
      return issues;
    }
  );

  // Start auto-fix for an issue
  ipcMain.on(
    IPC_CHANNELS.GITHUB_AUTOFIX_START,
    async (_, projectId: string, issueNumber: number) => {
      debugLog('startAutoFix handler called', { projectId, issueNumber });
      const mainWindow = getMainWindow();
      if (!mainWindow) {
        debugLog('No main window available');
        return;
      }

      const project = projectStore.getProject(projectId);
      if (!project) {
        debugLog('Project not found', { projectId });
        sendError(mainWindow, projectId, issueNumber, 'Project not found');
        return;
      }

      try {
        debugLog('Starting auto-fix for issue', { issueNumber });
        await startAutoFix(project, issueNumber, mainWindow);
        debugLog('Auto-fix completed for issue', { issueNumber });
      } catch (error) {
        debugLog('Auto-fix failed', { issueNumber, error: error instanceof Error ? error.message : error });
        sendError(
          mainWindow,
          projectId,
          issueNumber,
          error instanceof Error ? error.message : 'Failed to start auto-fix'
        );
      }
    }
  );

  debugLog('AutoFix handlers registered');
}
