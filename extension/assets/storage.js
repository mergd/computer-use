/**
 * storage.ts - Chrome storage utilities and stubs for MCP extension
 *
 * Minimal replacement for the bloated react-core.js.
 * Contains actual storage utilities plus no-op stubs for unused features.
 */
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
};
// =============================================================================
// Storage Functions
// =============================================================================
/**
 * Get a value from chrome.storage.local
 */
export async function getStorageValue(key, defaultValue) {
    const result = await chrome.storage.local.get(key);
    return (result[key] ?? defaultValue);
}
/**
 * Set a value in chrome.storage.local
 */
export async function setStorageValue(key, value) {
    await chrome.storage.local.set({ [key]: value });
}
/**
 * Remove a value from chrome.storage.local
 */
export async function removeStorageValue(key) {
    await chrome.storage.local.remove(key);
}
/**
 * Clear all MCP-related storage (for logout/reset)
 */
export async function clearMcpStorage() {
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
export function getEnvironmentConfig() {
    return {
        environment: "production",
        apiBaseUrl: "https://api.anthropic.com",
        wsApiBaseUrl: "wss://api.anthropic.com",
    };
}
/** Generate screenshot ID */
export function generateScreenshotId() {
    return `screenshot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
/** Get or create anonymous ID - stub */
export async function getOrCreateAnonymousId() {
    let id = await getStorageValue(StorageKeys.ANONYMOUS_ID);
    if (!id) {
        id = crypto.randomUUID();
        await setStorageValue(StorageKeys.ANONYMOUS_ID, id);
    }
    return id;
}
/** Dynamic import wrapper - just calls the function */
export async function dynamicImport(importFn) {
    return importFn();
}
/** Handle logout - clears storage */
export async function handleLogout() {
    await clearMcpStorage();
}
/** Handle OAuth redirect - stub (not used in MCP mode) */
export async function handleOAuthRedirect(_url, _tabId) {
    console.warn("handleOAuthRedirect called but not implemented in MCP mode");
    return { success: false };
}
/** Open side panel from tab - stub */
export async function openSidePanelFromTab(_tabId) {
    console.warn("openSidePanelFromTab called but not implemented in MCP mode");
}
/** SavedPromptsService - stub class */
export class SavedPromptsService {
    static async getAllPrompts() {
        return [];
    }
    static async updateAlarmForPrompt(_prompt) { }
    static async updateNextRunTimes() { }
}
/** Tool permission types (enum stub) - imported by mcp-tools.js */
export const ToolPermissionType = {
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
};
/** Format user identity - stub */
export function formatUserIdentity(_user) {
    return {};
}
// Additional stubs for mcp-tools imports
export const getStoragePromise = getStorageValue;
export function captureViewportDimensions() {
    return { width: 1920, height: 1080 };
}
export const SegmentConfig = {};
export async function getApiToken() {
    return undefined;
}
export const AuthHelpers = {};
export const SavedPromptsServiceInstance = new SavedPromptsService();
export const OAuthConfig = {};
export const Analytics = { track: () => { } };
export const extensionId = chrome?.runtime?.id || "unknown";
// =============================================================================
// Backwards compatibility exports (aliased to match react-core.js exports)
// =============================================================================
export { StorageKeys as S };
export { setStorageValue as s };
export { getStorageValue as g };
export { getEnvironmentConfig as h };
export { generateScreenshotId as k };
export { getOrCreateAnonymousId as d };
export { dynamicImport as _ };
export { handleLogout as H };
export { handleOAuthRedirect as I };
export { openSidePanelFromTab as o };
export { SavedPromptsService as b };
export { formatUserIdentity as K };
export { getStoragePromise as z };
export { captureViewportDimensions as w };
export { SegmentConfig as A };
export { getApiToken as x };
export { AuthHelpers as B };
export { SavedPromptsServiceInstance as y };
export { OAuthConfig as C };
export { Analytics as E };
export { ToolPermissionType as T };
export { extensionId as v };
