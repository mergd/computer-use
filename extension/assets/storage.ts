/**
 * storage.ts - Chrome storage utilities and stubs for MCP extension
 *
 * Minimal replacement for the bloated react-core.js.
 * Contains actual storage utilities plus no-op stubs for unused features.
 */

import type { ToolPermissionType as ToolPermissionTypeEnum } from "./types.js";

// =============================================================================
// Storage Keys
// =============================================================================

export const StorageKeys = {
  // MCP connection state
  MCP_CONNECTED: "mcp_connected",
  MCP_TAB_GROUP_ID: "mcp_tab_group_id",
  // Tab group management
  TAB_GROUPS: "tab_groups",
  DISMISSED_TAB_GROUPS: "dismissed_tab_groups",
  TARGET_TAB_ID: "target_tab_id",
  // Scheduled tasks
  PENDING_SCHEDULED_TASK: "pending_scheduled_task",
  // Extension updates
  UPDATE_AVAILABLE: "update_available",
  // OAuth (not used in MCP mode, but referenced)
  ACCESS_TOKEN: "access_token",
  REFRESH_TOKEN: "refresh_token",
  ANONYMOUS_ID: "anonymous_id",
} as const;

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys];

// =============================================================================
// Environment Config Types
// =============================================================================

export interface EnvironmentConfig {
  environment: string;
  apiBaseUrl: string;
  wsApiBaseUrl: string;
}

// =============================================================================
// Storage Functions
// =============================================================================

/**
 * Get a value from chrome.storage.local
 */
export async function getStorageValue<T>(key: string, defaultValue?: T): Promise<T> {
  const result = await chrome.storage.local.get(key);
  return (result[key] ?? defaultValue) as T;
}

/**
 * Set a value in chrome.storage.local
 */
export async function setStorageValue<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

/**
 * Remove a value from chrome.storage.local
 */
export async function removeStorageValue(key: string): Promise<void> {
  await chrome.storage.local.remove(key);
}

/**
 * Clear all MCP-related storage (for logout/reset)
 */
export async function clearMcpStorage(): Promise<void> {
  await chrome.storage.local.remove([
    StorageKeys.MCP_CONNECTED,
    StorageKeys.MCP_TAB_GROUP_ID,
    StorageKeys.TAB_GROUPS,
    StorageKeys.TARGET_TAB_ID,
  ]);
}

// =============================================================================
// Stubs for unused react-core.js exports (MCP mode doesn't need these)
// =============================================================================

/** Get environment/API config - stub */
export function getEnvironmentConfig(): EnvironmentConfig {
  return {
    environment: "production",
    apiBaseUrl: "https://api.anthropic.com",
    wsApiBaseUrl: "wss://api.anthropic.com",
  };
}

/** Generate screenshot ID */
export function generateScreenshotId(): string {
  return `screenshot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Get or create anonymous ID - stub */
export async function getOrCreateAnonymousId(): Promise<string> {
  let id = await getStorageValue<string | undefined>(StorageKeys.ANONYMOUS_ID);
  if (!id) {
    id = crypto.randomUUID();
    await setStorageValue(StorageKeys.ANONYMOUS_ID, id);
  }
  return id;
}

/** Dynamic import wrapper - just calls the function */
export async function dynamicImport<T>(importFn: () => Promise<T>): Promise<T> {
  return importFn();
}

/** Handle logout - clears storage */
export async function handleLogout(): Promise<void> {
  await clearMcpStorage();
}

/** OAuth redirect result type */
export interface OAuthRedirectResult {
  success: boolean;
}

/** Handle OAuth redirect - stub (not used in MCP mode) */
export async function handleOAuthRedirect(
  _url: string,
  _tabId: number
): Promise<OAuthRedirectResult> {
  console.warn("handleOAuthRedirect called but not implemented in MCP mode");
  return { success: false };
}

/** Open side panel from tab - stub */
export async function openSidePanelFromTab(_tabId: number): Promise<void> {
  console.warn("openSidePanelFromTab called but not implemented in MCP mode");
}

/** Saved prompt type */
export interface SavedPrompt {
  id: string;
  command?: string;
  prompt?: string;
  url?: string;
  repeatType?: string;
  skipPermissions?: boolean;
  model?: string;
  [key: string]: unknown;
}

/** SavedPromptsService - stub class */
export class SavedPromptsService {
  static async getAllPrompts(): Promise<SavedPrompt[]> {
    return [];
  }
  static async updateAlarmForPrompt(_prompt: SavedPrompt): Promise<void> {}
  static async updateNextRunTimes(): Promise<void> {}
  static async getPromptById(_id: string): Promise<SavedPrompt | null> {
    return null;
  }
  static async getPromptByCommand(_command: string): Promise<SavedPrompt | null> {
    return null;
  }
  static async recordPromptUsage(_id: string): Promise<void> {}
}

/** Tool permission types (enum stub) - imported by mcp-tools.js */
export const ToolPermissionType: Record<string, ToolPermissionTypeEnum> = {
  NAVIGATE: "navigate",
  READ_PAGE_CONTENT: "read_page_content",
  READ_CONSOLE_MESSAGES: "read_console_messages",
  READ_NETWORK_REQUESTS: "read_network_requests",
  CLICK: "click",
  TYPE: "type",
  UPLOAD_IMAGE: "upload_image",
  DOMAIN_TRANSITION: "domain_transition",
  PLAN_APPROVAL: "plan_approval",
  EXECUTE_JAVASCRIPT: "execute_javascript",
  REMOTE_MCP: "remote_mcp",
} as const;

/** User type for formatUserIdentity */
export interface User {
  [key: string]: unknown;
}

/** Format user identity - stub */
export function formatUserIdentity(_user: User): Record<string, unknown> {
  return {};
}

// Additional stubs for mcp-tools imports
export const getStoragePromise = getStorageValue;

export interface ViewportDimensions {
  width: number;
  height: number;
}

export function captureViewportDimensions(): ViewportDimensions {
  return { width: 1920, height: 1080 };
}

export const SegmentConfig: Record<string, unknown> = {};

export async function getApiToken(): Promise<string | undefined> {
  return undefined;
}

export const AuthHelpers: Record<string, unknown> = {};
export const SavedPromptsServiceInstance = new SavedPromptsService();
export const OAuthConfig: Record<string, unknown> = {};

export interface AnalyticsInterface {
  track: (event: string, data?: Record<string, unknown>) => void;
}

export const Analytics: AnalyticsInterface = { track: () => {} };
export const extensionId: string = chrome?.runtime?.id || "unknown";

