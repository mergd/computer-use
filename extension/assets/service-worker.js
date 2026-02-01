/**
 * service-worker.ts - Main service worker entry point for Chrome extension
 *
 * This is the background service worker that handles:
 * - Native messaging communication with the MCP server
 * - Tool execution requests from the native host
 * - Chrome extension lifecycle events
 * - Tab group management coordination
 * - Scheduled prompt/task execution
 * - OAuth and external message handling
 */
import { s as setStorageValue, S as StorageKeys, h as getApiConfig, H as handleLogout, I as handleOAuthRedirect, b as SavedPromptsService, } from "./storage.js";
import { L as notifyDisconnection, t as TabGroupManager, M as createErrorResponse, N as executeToolRequest, } from "./mcp-tools.js";
/** Native messaging connection state */
let nativePort = null;
let isConnecting = false;
let isNativeHostInstalled = false;
let isMcpConnected = false;
/** Status request handling */
let statusResolve = null;
let statusTimeout = null;
/** Extension URL handling path prefix */
const EXTENSION_URL_PREFIX = "/chrome/";
/** Cache for main tab aliveness checks */
const mainTabAlivenessCache = new Map();
/** Offscreen document creation state */
let offscreenDocumentCreated = false;
// =============================================================================
// Native Messaging Functions
// =============================================================================
/**
 * Handle native messaging errors, detecting if the host is not found
 */
function handleNativeMessagingError(errorMessage) {
    if (errorMessage?.includes("native messaging host not found")) {
        isNativeHostInstalled = false;
    }
}
/**
 * Attempt to connect to the native messaging host
 * Tries multiple host configurations in order of priority
 */
async function connectToNativeHost() {
    try {
        return await (async function attemptConnection() {
            // Already connected
            if (nativePort) {
                return true;
            }
            // Connection already in progress
            if (isConnecting) {
                return false;
            }
            isConnecting = true;
            try {
                // Check if we have native messaging permission
                const hasNativeMessagingPermission = await chrome.permissions.contains({
                    permissions: ["nativeMessaging"],
                });
                if (!hasNativeMessagingPermission) {
                    return false;
                }
                // Check if connectNative is available
                if (typeof chrome.runtime.connectNative !== "function") {
                    return false;
                }
                // Try different native host configurations
                const hostConfigurations = [
                    { name: "com.browsermcp.native_host_desktop", label: "Desktop" },
                    { name: "com.browsermcp.native_host", label: "Claude Code" },
                ];
                for (const hostConfig of hostConfigurations) {
                    try {
                        const port = chrome.runtime.connectNative(hostConfig.name);
                        // Try to establish connection with a ping/pong handshake
                        const connectionSuccessful = await new Promise((resolve) => {
                            let resolved = false;
                            const handleDisconnect = () => {
                                if (!resolved) {
                                    resolved = true;
                                    // Clear any error from lastError
                                    void chrome.runtime.lastError;
                                    resolve(false);
                                }
                            };
                            const handleMessage = (message) => {
                                if (!resolved && message.type === "pong") {
                                    resolved = true;
                                    port.onDisconnect.removeListener(handleDisconnect);
                                    port.onMessage.removeListener(handleMessage);
                                    resolve(true);
                                }
                            };
                            port.onDisconnect.addListener(handleDisconnect);
                            port.onMessage.addListener(handleMessage);
                            try {
                                port.postMessage({ type: "ping" });
                            }
                            catch {
                                if (!resolved) {
                                    resolved = true;
                                    resolve(false);
                                }
                                return;
                            }
                            // Timeout after 10 seconds
                            setTimeout(() => {
                                if (!resolved) {
                                    resolved = true;
                                    port.onDisconnect.removeListener(handleDisconnect);
                                    port.onMessage.removeListener(handleMessage);
                                    resolve(false);
                                }
                            }, 10000);
                        });
                        if (connectionSuccessful) {
                            // Store the successful connection
                            nativePort = port;
                            isNativeHostInstalled = true;
                            // Set up message handler for incoming messages
                            nativePort.onMessage.addListener(async (message) => {
                                await handleNativeMessage(message);
                            });
                            // Set up disconnect handler
                            nativePort.onDisconnect.addListener(() => {
                                const errorMessage = chrome.runtime.lastError?.message;
                                nativePort = null;
                                isMcpConnected = false;
                                void setStorageValue(StorageKeys.MCP_CONNECTED, false);
                                handleNativeMessagingError(errorMessage);
                                notifyDisconnection();
                            });
                            // Request initial status
                            nativePort.postMessage({ type: "get_status" });
                            return true;
                        }
                        // This host didn't work, disconnect and try next
                        port.disconnect();
                    }
                    catch {
                        // Continue to next host configuration
                    }
                }
                // No host configuration worked
                return false;
            }
            catch (error) {
                if (error instanceof Error) {
                    handleNativeMessagingError(error.message);
                }
                return false;
            }
            finally {
                isConnecting = false;
            }
        })();
    }
    catch {
        return false;
    }
}
/**
 * Disconnect from native host and revoke permissions
 */
async function disconnectNativeHost() {
    try {
        await chrome.permissions.remove({ permissions: ["nativeMessaging"] });
        nativePort?.disconnect();
        nativePort = null;
        isConnecting = false;
        isNativeHostInstalled = false;
        isMcpConnected = false;
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Handle incoming messages from native host
 */
async function handleNativeMessage(message) {
    switch (message.type) {
        case "tool_request":
            await handleToolRequest(message);
            break;
        case "status_response":
            if (statusResolve) {
                if (statusTimeout) {
                    clearTimeout(statusTimeout);
                    statusTimeout = null;
                }
                statusResolve({
                    nativeHostInstalled: isNativeHostInstalled,
                    mcpConnected: isMcpConnected,
                });
                statusResolve = null;
            }
            break;
        case "mcp_connected":
            handleMcpConnected();
            break;
        case "set_skip_permissions":
            self.__skipPermissions = !!message.value;
            break;
        case "mcp_disconnected":
            isMcpConnected = false;
            void setStorageValue(StorageKeys.MCP_CONNECTED, false);
            TabGroupManager.stopTabGroupChangeListener();
            break;
    }
}
/**
 * Handle tool execution request from native host
 */
async function handleToolRequest(request) {
    try {
        const { method, params } = request;
        if (method === "execute_tool") {
            if (!params?.tool) {
                sendToolResponse(createErrorResponse("No tool specified"));
                return;
            }
            const clientId = params.client_id;
            const tabGroupId = params.args?.tabGroupId;
            const validatedTabGroupId = typeof tabGroupId === "number" ? tabGroupId : undefined;
            const tabId = params.args?.tabId;
            const validatedTabId = typeof tabId === "number" ? tabId : undefined;
            const toolName = params.tool;
            // Handle clipboard_read tool
            if (toolName === "clipboard_read") {
                try {
                    await ensureOffscreenDocument();
                    const response = await chrome.runtime.sendMessage({ type: "CLIPBOARD_READ" });
                    if (response?.success) {
                        sendToolResponse({ content: response.text || "" }, clientId);
                    }
                    else {
                        sendToolResponse(createErrorResponse(response?.error || "Failed to read clipboard"), clientId);
                    }
                }
                catch (err) {
                    sendToolResponse(createErrorResponse(err.message), clientId);
                }
                return;
            }
            // Handle clipboard_write tool
            if (toolName === "clipboard_write") {
                try {
                    await ensureOffscreenDocument();
                    const response = await chrome.runtime.sendMessage({
                        type: "CLIPBOARD_WRITE",
                        text: params.args?.text || ""
                    });
                    if (response?.success) {
                        sendToolResponse({ content: "Text copied to clipboard" }, clientId);
                    }
                    else {
                        sendToolResponse(createErrorResponse(response?.error || "Failed to write to clipboard"), clientId);
                    }
                }
                catch (err) {
                    sendToolResponse(createErrorResponse(err.message), clientId);
                }
                return;
            }
            // Handle get_cookies tool
            if (toolName === "get_cookies") {
                try {
                    const cookies = await chrome.cookies.getAll({
                        url: params.args?.url,
                    });
                    const filtered = params.args?.name
                        ? cookies.filter((c) => c.name === params.args?.name)
                        : cookies;
                    sendToolResponse({ content: JSON.stringify(filtered, null, 2) }, clientId);
                }
                catch (err) {
                    sendToolResponse(createErrorResponse(err.message), clientId);
                }
                return;
            }
            // Handle set_cookie tool
            if (toolName === "set_cookie") {
                try {
                    const opts = {
                        url: params.args?.url,
                        name: params.args?.name,
                        value: params.args?.value,
                    };
                    if (params.args?.domain)
                        opts.domain = params.args.domain;
                    if (params.args?.path)
                        opts.path = params.args.path;
                    if (params.args?.secure)
                        opts.secure = params.args.secure;
                    if (params.args?.httpOnly)
                        opts.httpOnly = params.args.httpOnly;
                    if (params.args?.expirationDate)
                        opts.expirationDate = params.args.expirationDate;
                    const cookie = await chrome.cookies.set(opts);
                    sendToolResponse({ content: JSON.stringify(cookie, null, 2) }, clientId);
                }
                catch (err) {
                    sendToolResponse(createErrorResponse(err.message), clientId);
                }
                return;
            }
            // Handle delete_cookie tool
            if (toolName === "delete_cookie") {
                try {
                    await chrome.cookies.remove({
                        url: params.args?.url,
                        name: params.args?.name,
                    });
                    sendToolResponse({ content: "Cookie deleted" }, clientId);
                }
                catch (err) {
                    sendToolResponse(createErrorResponse(err.message), clientId);
                }
                return;
            }
            // Handle search_history tool
            if (toolName === "search_history") {
                try {
                    const opts = {
                        text: params.args?.query || "",
                        maxResults: params.args?.maxResults || 100,
                    };
                    if (params.args?.startTime)
                        opts.startTime = params.args.startTime;
                    if (params.args?.endTime)
                        opts.endTime = params.args.endTime;
                    const results = await chrome.history.search(opts);
                    sendToolResponse({ content: JSON.stringify(results, null, 2) }, clientId);
                }
                catch (err) {
                    sendToolResponse(createErrorResponse(err.message), clientId);
                }
                return;
            }
            // Handle other tools through the general tool executor
            const toolRequest = {
                toolName: params.tool,
                args: params.args || {},
                tabId: validatedTabId,
                tabGroupId: validatedTabGroupId,
                clientId: clientId,
            };
            sendToolResponse(await executeToolRequest(toolRequest), clientId);
        }
        else {
            sendToolResponse({ content: `Unknown method: ${method}` });
        }
    }
    catch (error) {
        sendToolResponse(createErrorResponse(`Tool execution failed: ${error instanceof Error ? error.message : "Unknown error"}`));
    }
}
/**
 * Handle MCP connected event
 */
function handleMcpConnected() {
    isMcpConnected = true;
    void setStorageValue(StorageKeys.MCP_CONNECTED, true);
    TabGroupManager.initialize();
    TabGroupManager.startTabGroupChangeListener();
}
/**
 * Enhance error message for permission denials
 */
function enhancePermissionDenialMessage(content) {
    let enhancedContent;
    const permissionDenialSuffix = "IMPORTANT: The user has explicitly declined this action. Do not attempt to use other tools or workarounds. Instead, acknowledge the denial and ask the user how they would prefer to proceed.";
    if (typeof content === "string") {
        if (content.includes("Permission denied by user")) {
            enhancedContent = `${content} - ${permissionDenialSuffix}`;
        }
        else {
            enhancedContent = content;
        }
    }
    else {
        // Handle array of content items
        enhancedContent = content.map((item) => {
            if (typeof item === "object" &&
                item !== null &&
                "text" in item &&
                typeof item.text === "string" &&
                item.text.includes("Permission denied by user")) {
                return { ...item, text: `${content} - ${permissionDenialSuffix}` };
            }
            return item;
        });
    }
    return { type: "tool_response", error: { content: enhancedContent } };
}
/**
 * Send tool response back to native host
 */
function sendToolResponse(response, clientId) {
    if (!nativePort) {
        return;
    }
    const { content, is_error } = response;
    if (!content || (typeof content !== "string" && !Array.isArray(content))) {
        return;
    }
    let nativeResponse;
    if (is_error) {
        nativeResponse = enhancePermissionDenialMessage(content);
    }
    else {
        nativeResponse = { type: "tool_response", result: { content: content } };
    }
    nativePort.postMessage(nativeResponse);
}
// =============================================================================
// Network Request Rules
// =============================================================================
/**
 * Set up declarative net request rules for API requests
 */
async function setupNetRequestRules() {
    const apiConfig = getApiConfig();
    const userAgent = `claude-browser-extension/${chrome.runtime.getManifest().version} (external) ${navigator.userAgent}`;
    const rules = [
        {
            id: 1,
            priority: 1,
            action: {
                type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
                requestHeaders: [
                    {
                        header: "User-Agent",
                        operation: chrome.declarativeNetRequest.HeaderOperation.SET,
                        value: userAgent,
                    },
                ],
            },
            condition: {
                urlFilter: `${apiConfig.apiBaseUrl}/*`,
                resourceTypes: [
                    chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
                    chrome.declarativeNetRequest.ResourceType.OTHER,
                ],
            },
        },
    ];
    await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [1],
        addRules: rules,
    });
}
// =============================================================================
// Extension URL Handling
// =============================================================================
/**
 * Handle extension-specific URLs (clau.de/chrome/*)
 */
async function handleExtensionUrl(url, tabId) {
    try {
        const parsedUrl = new URL(url);
        // Only handle clau.de URLs
        if (parsedUrl.host !== "clau.de") {
            return false;
        }
        // Handle permissions URL
        if (parsedUrl.pathname.toLowerCase() === "/chrome/permissions") {
            await handlePermissionsUrl(tabId);
            return true;
        }
        // Only handle /chrome/* paths from here
        if (!parsedUrl.pathname.startsWith(EXTENSION_URL_PREFIX)) {
            return false;
        }
        const pathCommand = parsedUrl.pathname.substring(8).toLowerCase();
        // Handle reconnect command
        if (pathCommand === "reconnect") {
            await handleReconnectUrl(tabId);
            return true;
        }
        // Handle tab switching
        if (pathCommand.startsWith("tab/")) {
            const targetTabId = parseInt(pathCommand.substring(4), 10);
            await handleTabSwitchUrl(targetTabId, tabId);
            return true;
        }
        return false;
    }
    catch {
        return false;
    }
}
/**
 * Handle /chrome/permissions URL
 */
async function handlePermissionsUrl(tabId) {
    try {
        const optionsUrl = chrome.runtime.getURL("options.html#permissions");
        await chrome.tabs.create({ url: optionsUrl });
    }
    catch {
        // Ignore errors
    }
    finally {
        await closeTab(tabId);
    }
}
/**
 * Handle /chrome/reconnect URL
 */
async function handleReconnectUrl(tabId) {
    try {
        await disconnectNativeHost();
        await new Promise((resolve) => setTimeout(resolve, 500));
        await connectToNativeHost();
    }
    catch {
        // Reconnect failed
    }
    finally {
        await closeTab(tabId);
    }
}
/**
 * Handle /chrome/tab/* URL for switching tabs
 */
async function handleTabSwitchUrl(targetTabId, currentTabId) {
    if (isNaN(targetTabId)) {
        await closeTab(currentTabId);
        return true;
    }
    try {
        await TabGroupManager.initialize();
        const group = await TabGroupManager.findGroupByTab(targetTabId);
        if (!group || group.isUnmanaged) {
            await closeTab(currentTabId);
            return true;
        }
        const tab = await chrome.tabs.get(targetTabId);
        if (tab.windowId !== undefined) {
            await chrome.windows.update(tab.windowId, { focused: true });
        }
        await chrome.tabs.update(targetTabId, { active: true });
        await closeTab(currentTabId);
        return true;
    }
    catch {
        await closeTab(currentTabId);
        return true;
    }
}
/**
 * Close a tab by ID, silently ignoring errors
 */
async function closeTab(tabId) {
    try {
        await chrome.tabs.remove(tabId);
    }
    catch {
        // Ignore errors when closing tabs
    }
}
// =============================================================================
// Scheduled Tasks
// =============================================================================
/**
 * Initialize alarms for scheduled prompts
 */
async function initializeScheduledPromptAlarms() {
    try {
        const allPrompts = await SavedPromptsService.getAllPrompts();
        const repeatingPrompts = allPrompts.filter((prompt) => prompt.repeatType && prompt.repeatType !== "none");
        if (repeatingPrompts.length === 0) {
            return;
        }
        let successCount = 0;
        let failCount = 0;
        for (const prompt of repeatingPrompts) {
            try {
                await SavedPromptsService.updateAlarmForPrompt(prompt);
                successCount++;
            }
            catch {
                failCount++;
            }
        }
        try {
            await SavedPromptsService.updateNextRunTimes();
        }
        catch {
            // Ignore errors
        }
    }
    catch {
        // Ignore errors
    }
}
/**
 * Create a new window and group for a scheduled task
 */
async function executeScheduledTaskInNewWindow(task, runLogId) {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const newWindow = await chrome.windows.create({
        url: task.url || "about:blank",
        type: "normal",
        focused: true,
    });
    if (!newWindow || !newWindow.id || !newWindow.tabs || newWindow.tabs.length === 0) {
        throw new Error("Failed to create window for scheduled task");
    }
    const newTab = newWindow.tabs[0];
    if (!newTab.id) {
        throw new Error("Failed to get tab in new window for scheduled task");
    }
    await TabGroupManager.initialize(true);
    await TabGroupManager.createGroup(newTab.id);
    await setStorageValue(StorageKeys.TARGET_TAB_ID, newTab.id);
}
// =============================================================================
// Tab Group Management
// =============================================================================
/**
 * Ensure a tab is part of a managed group, creating one if needed
 */
async function ensureTabInManagedGroup(tabId) {
    await TabGroupManager.initialize(true);
    const group = await TabGroupManager.findGroupByTab(tabId);
    if (group) {
        if (group.isUnmanaged) {
            try {
                await TabGroupManager.adoptOrphanedGroup(tabId, group.chromeGroupId);
            }
            catch {
                // Ignore errors
            }
            return;
        }
    }
    else {
        try {
            await TabGroupManager.createGroup(tabId);
        }
        catch {
            // Ignore errors
        }
        void connectToNativeHost();
    }
}
/**
 * Handle action button click on a tab
 */
async function handleActionClick(tab) {
    const tabId = tab.id;
    if (tabId) {
        await ensureTabInManagedGroup(tabId);
    }
}
// =============================================================================
// Native Host Status
// =============================================================================
/**
 * Get current native host connection status
 */
async function getNativeHostStatus() {
    if (!nativePort || !isNativeHostInstalled) {
        return {
            nativeHostInstalled: isNativeHostInstalled,
            mcpConnected: isMcpConnected,
        };
    }
    // Clear any existing status timeout
    if (statusTimeout) {
        clearTimeout(statusTimeout);
    }
    return new Promise((resolve) => {
        statusResolve = resolve;
        nativePort.postMessage({ type: "get_status" });
        statusTimeout = setTimeout(() => {
            statusResolve = null;
            resolve({
                nativeHostInstalled: isNativeHostInstalled,
                mcpConnected: isMcpConnected,
            });
        }, 10000);
    });
}
/**
 * Send an MCP notification to the native host
 */
function sendMcpNotification(method, params) {
    if (!nativePort) {
        return false;
    }
    const notification = {
        type: "notification",
        jsonrpc: "2.0",
        method: method,
        params: params || {},
    };
    nativePort.postMessage(notification);
    return true;
}
// =============================================================================
// Offscreen Document Management
// =============================================================================
/**
 * Ensure offscreen document exists for clipboard/audio operations
 */
async function ensureOffscreenDocument() {
    if (!chrome.offscreen) {
        throw new Error("Offscreen API not available");
    }
    // Check if we already have an offscreen document
    if (offscreenDocumentCreated) {
        return;
    }
    try {
        // Try to check if document already exists by querying contexts
        const contexts = await chrome.runtime.getContexts({
            contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
            documentUrls: [chrome.runtime.getURL("offscreen.html")]
        });
        if (contexts.length > 0) {
            offscreenDocumentCreated = true;
            return;
        }
        await chrome.offscreen.createDocument({
            url: "offscreen.html",
            reasons: [chrome.offscreen.Reason.CLIPBOARD],
            justification: "Clipboard and audio operations require DOM access",
        });
        offscreenDocumentCreated = true;
    }
    catch (error) {
        // If error is because document already exists, that's fine
        if (error.message?.includes("Only a single offscreen document")) {
            offscreenDocumentCreated = true;
            return;
        }
        throw error;
    }
}
/**
 * Create offscreen document for audio playback
 */
async function createOffscreenDocument() {
    if (!chrome.offscreen) {
        return;
    }
    try {
        // Close any existing offscreen document
        try {
            await chrome.offscreen.closeDocument();
        }
        catch {
            // Ignore errors
        }
        await chrome.offscreen.createDocument({
            url: "offscreen.html",
            reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
            justification: "Play notification sounds when user is on different tab",
        });
    }
    catch {
        throw new Error("Failed to create offscreen document");
    }
}
/**
 * Retry populating the input text with exponential backoff
 */
async function retryPopulateInput(message, attempt = 0) {
    try {
        const delay = attempt === 0 ? 800 : 500;
        await new Promise((resolve) => setTimeout(resolve, delay));
        await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                type: "POPULATE_INPUT_TEXT",
                prompt: message.prompt,
                permissionMode: message.permissionMode,
                selectedModel: message.selectedModel,
                attachments: message.attachments,
            }, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                }
                else {
                    resolve();
                }
            });
        });
    }
    catch {
        if (attempt < 5) {
            await retryPopulateInput(message, attempt + 1);
        }
    }
}
/**
 * Retry loading a conversation with exponential backoff
 */
async function retryLoadConversation(conversationUuid, attempt = 0) {
    try {
        const delay = attempt === 0 ? 800 : 500;
        await new Promise((resolve) => setTimeout(resolve, delay));
        await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                type: "LOAD_CONVERSATION",
                conversationUuid: conversationUuid,
            }, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                }
                else {
                    resolve();
                }
            });
        });
    }
    catch {
        if (attempt < 5) {
            await retryLoadConversation(conversationUuid, attempt + 1);
        }
    }
}
// =============================================================================
// Static Indicator Handlers
// =============================================================================
/**
 * Handle static indicator heartbeat check
 */
async function handleStaticIndicatorHeartbeat(sender, sendResponse) {
    const senderTabId = sender.tab?.id;
    if (!senderTabId) {
        sendResponse({ success: false });
        return;
    }
    try {
        const senderTab = await chrome.tabs.get(senderTabId);
        const groupId = senderTab.groupId;
        if (groupId === undefined || groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
            sendResponse({ success: false });
            return;
        }
        // Check if sender tab is in a managed group
        if (await TabGroupManager.findGroupByTab(senderTabId)) {
            sendResponse({ success: true });
            return;
        }
        // Get all tabs in the same group
        const groupTabs = await chrome.tabs.query({ groupId: groupId });
        // Check each other tab in the group for an active main tab
        const checkTabForMainTab = async (index) => {
            if (index >= groupTabs.length) {
                sendResponse({ success: false });
                return;
            }
            const candidateTab = groupTabs[index];
            // Skip the sender tab and tabs without IDs
            if (candidateTab.id === senderTabId || !candidateTab.id) {
                await checkTabForMainTab(index + 1);
                return;
            }
            const candidateTabId = candidateTab.id;
            const now = Date.now();
            const cached = mainTabAlivenessCache.get(candidateTabId);
            // Use cached result if fresh (within 3 seconds)
            if (cached && now - cached.timestamp < 3000) {
                if (cached.isAlive) {
                    sendResponse({ success: true });
                }
                else {
                    await checkTabForMainTab(index + 1);
                }
                return;
            }
            // Check if this tab is a main tab
            chrome.runtime.sendMessage({
                type: "MAIN_TAB_ACK_REQUEST",
                secondaryTabId: senderTabId,
                mainTabId: candidateTabId,
                timestamp: now,
            }, async (response) => {
                const isAlive = response?.success ?? false;
                mainTabAlivenessCache.set(candidateTabId, {
                    timestamp: now,
                    isAlive: isAlive,
                });
                if (isAlive) {
                    sendResponse({ success: true });
                }
                else {
                    await checkTabForMainTab(index + 1);
                }
            });
        };
        await checkTabForMainTab(0);
    }
    catch {
        sendResponse({ success: false });
    }
}
/**
 * Handle dismissing static indicators for a tab group
 */
async function handleDismissStaticIndicator(sender, sendResponse) {
    const senderTabId = sender.tab?.id;
    if (!senderTabId) {
        sendResponse({ success: false });
        return;
    }
    try {
        const senderTab = await chrome.tabs.get(senderTabId);
        const groupId = senderTab.groupId;
        if (groupId === undefined || groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
            sendResponse({ success: false });
            return;
        }
        await TabGroupManager.initialize();
        await TabGroupManager.dismissStaticIndicatorsForGroup(groupId);
        sendResponse({ success: true });
    }
    catch {
        sendResponse({ success: false });
    }
}
// =============================================================================
// Extension Lifecycle Event Handlers
// =============================================================================
// Initialize extension on load
void connectToNativeHost();
chrome.runtime.onInstalled.addListener(async (details) => {
    chrome.storage.local.remove(["updateAvailable"]);
    await TabGroupManager.initialize();
    await setupNetRequestRules();
    void connectToNativeHost();
    await initializeScheduledPromptAlarms();
});
chrome.runtime.onStartup.addListener(async () => {
    await setupNetRequestRules();
    await TabGroupManager.initialize();
    void connectToNativeHost();
    await initializeScheduledPromptAlarms();
});
chrome.permissions.onAdded.addListener((permissions) => {
    if (permissions.permissions?.includes("nativeMessaging")) {
        void connectToNativeHost();
    }
});
chrome.permissions.onRemoved.addListener((permissions) => {
    if (permissions.permissions?.includes("nativeMessaging")) {
        void disconnectNativeHost();
    }
});
chrome.action.onClicked.addListener(handleActionClick);
chrome.notifications.onClicked.addListener(async (notificationId) => {
    chrome.notifications.clear(notificationId);
    const parts = notificationId.split("_");
    let tabId = null;
    if (parts.length >= 2 && parts[1] !== "unknown") {
        tabId = parseInt(parts[1], 10);
    }
    if (tabId && !isNaN(tabId)) {
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab && tab.windowId) {
                await chrome.windows.update(tab.windowId, { focused: true });
                await chrome.tabs.update(tabId, { active: true });
                return;
            }
        }
        catch {
            // Tab doesn't exist, fall through to focus current window
        }
    }
    // Focus the current active tab's window
    const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
    });
    if (activeTab?.id && activeTab.windowId) {
        await chrome.windows.update(activeTab.windowId, { focused: true });
    }
});
chrome.commands.onCommand.addListener((command) => {
    if (command === "toggle-side-panel") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs[0];
            if (activeTab) {
                void handleActionClick(activeTab);
            }
        });
    }
});
chrome.runtime.onUpdateAvailable.addListener((details) => {
    void setStorageValue(StorageKeys.UPDATE_AVAILABLE, true);
});
// Tab removal handler
chrome.tabs.onRemoved.addListener(async (tabId) => {
    await TabGroupManager.handleTabClosed(tabId);
});
// Web navigation handler for extension URLs
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    if (details.frameId === 0) {
        await handleExtensionUrl(details.url, details.tabId);
    }
});
// =============================================================================
// Message Handlers
// =============================================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        // Handle notification sound playback
        if (message.type === "PLAY_NOTIFICATION_SOUND") {
            try {
                await createOffscreenDocument();
                await chrome.runtime.sendMessage({
                    type: "PLAY_NOTIFICATION_SOUND",
                    audioUrl: message.audioUrl,
                    volume: message.volume || 0.5,
                });
                sendResponse({ success: true });
            }
            catch (error) {
                sendResponse({ success: false, error: error.message });
            }
            return;
        }
        // Handle open side panel request
        if (message.type === "open_side_panel") {
            const tabId = message.tabId || sender.tab?.id;
            if (!tabId) {
                sendResponse({ success: false });
                return;
            }
            await ensureTabInManagedGroup(tabId);
            // If a prompt is provided, populate the input
            if (message.prompt) {
                await retryPopulateInput(message);
            }
            // If a conversation UUID is provided, load it
            if (message.conversationUuid) {
                await retryLoadConversation(message.conversationUuid);
            }
            sendResponse({ success: true });
            return;
        }
        // Handle logout
        if (message.type === "logout") {
            try {
                await handleLogout();
                await TabGroupManager.clearAllGroups();
                sendResponse({ success: true });
            }
            catch {
                // Ignore errors
            }
            return;
        }
        // Handle native host status check
        if (message.type === "check_native_host_status") {
            const status = await getNativeHostStatus();
            sendResponse({ status: status });
            return;
        }
        // Handle MCP notification sending
        if (message.type === "SEND_MCP_NOTIFICATION") {
            const success = sendMcpNotification(message.method, message.params);
            sendResponse({ success: success });
            return;
        }
        // Handle opening options with a scheduled task
        if (message.type === "OPEN_OPTIONS_WITH_TASK") {
            try {
                await setStorageValue(StorageKeys.PENDING_SCHEDULED_TASK, message.task);
                const optionsUrl = chrome.runtime.getURL("options.html");
                const allTabs = await chrome.tabs.query({});
                const existingOptionsTab = allTabs.find((tab) => tab.url?.startsWith(optionsUrl));
                if (existingOptionsTab && existingOptionsTab.id) {
                    await chrome.tabs.update(existingOptionsTab.id, {
                        url: chrome.runtime.getURL("options.html#prompts"),
                        active: true,
                    });
                    if (existingOptionsTab.windowId) {
                        await chrome.windows.update(existingOptionsTab.windowId, {
                            focused: true,
                        });
                    }
                }
                else {
                    await chrome.tabs.create({
                        url: chrome.runtime.getURL("options.html#prompts"),
                    });
                }
                sendResponse({ success: true });
            }
            catch (error) {
                sendResponse({ success: false, error: error.message });
            }
            return;
        }
        // Handle scheduled task execution
        if (message.type === "EXECUTE_SCHEDULED_TASK") {
            try {
                const { task, runLogId } = message;
                await executeScheduledTaskInNewWindow(task, runLogId);
                sendResponse({ success: true });
            }
            catch (error) {
                sendResponse({ success: false, error: error.message });
            }
            return;
        }
        // Handle stop agent request
        if (message.type === "STOP_AGENT") {
            let targetTabId;
            if (message.fromTabId === "CURRENT_TAB" && sender.tab?.id) {
                targetTabId =
                    (await TabGroupManager.getMainTabId(sender.tab.id)) || sender.tab.id;
            }
            else if (typeof message.fromTabId === "number") {
                targetTabId = message.fromTabId;
            }
            if (targetTabId) {
                chrome.runtime.sendMessage({
                    type: "STOP_AGENT",
                    targetTabId: targetTabId,
                });
            }
            sendResponse({ success: true });
            return;
        }
        // Handle switch to main tab request
        if (message.type === "SWITCH_TO_MAIN_TAB") {
            if (!sender.tab?.id) {
                sendResponse({ success: false, error: "No sender tab" });
                return;
            }
            try {
                await TabGroupManager.initialize(true);
                const mainTabId = await TabGroupManager.getMainTabId(sender.tab.id);
                if (mainTabId) {
                    await chrome.tabs.update(mainTabId, { active: true });
                    const mainTab = await chrome.tabs.get(mainTabId);
                    if (mainTab.windowId) {
                        await chrome.windows.update(mainTab.windowId, { focused: true });
                    }
                    sendResponse({ success: true });
                }
                else {
                    sendResponse({ success: false, error: "No main tab found" });
                }
            }
            catch (error) {
                sendResponse({ success: false, error: error.message });
            }
            return;
        }
        // Handle secondary tab checking main tab status
        if (message.type === "SECONDARY_TAB_CHECK_MAIN") {
            chrome.runtime.sendMessage({
                type: "MAIN_TAB_ACK_REQUEST",
                secondaryTabId: message.secondaryTabId,
                mainTabId: message.mainTabId,
                timestamp: message.timestamp,
            }, (response) => {
                sendResponse(response?.success ? { success: true } : { success: false });
            });
            return;
        }
        // Handle main tab acknowledgment response
        if (message.type === "MAIN_TAB_ACK_RESPONSE") {
            sendResponse({ success: message.success });
            return;
        }
        // Handle static indicator heartbeat
        if (message.type === "STATIC_INDICATOR_HEARTBEAT") {
            await handleStaticIndicatorHeartbeat(sender, sendResponse);
            return;
        }
        // Handle dismissing static indicator for a group
        if (message.type === "DISMISS_STATIC_INDICATOR_FOR_GROUP") {
            await handleDismissStaticIndicator(sender, sendResponse);
            return;
        }
    })();
    // Return true to indicate async response
    return true;
});
// =============================================================================
// Alarm Handler for Scheduled Tasks
// =============================================================================
chrome.alarms.onAlarm.addListener(async (alarm) => {
    // Handle prompt alarms
    if (alarm.name.startsWith("prompt_")) {
        try {
            const alarmName = alarm.name;
            const storage = await chrome.storage.local.get(["savedPrompts"]);
            const prompts = storage.savedPrompts || [];
            const prompt = prompts.find((p) => p.id === alarmName);
            if (prompt) {
                const runLogId = `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
                let executionError = null;
                try {
                    const task = {
                        id: prompt.id,
                        name: prompt.command || "Scheduled Task",
                        prompt: prompt.prompt,
                        url: prompt.url,
                        enabled: true,
                        skipPermissions: prompt.skipPermissions !== false,
                        model: prompt.model,
                    };
                    await executeScheduledTaskInNewWindow(task, runLogId);
                }
                catch (error) {
                    executionError = error instanceof Error ? error : new Error(String(error));
                    try {
                        await chrome.notifications.create({
                            type: "basic",
                            iconUrl: "/icon-128.png",
                            title: "Scheduled Task Failed",
                            message: `Task "${prompt.command || "Scheduled Task"}" failed to execute. ${executionError.message}`,
                            priority: 2,
                        });
                    }
                    catch {
                        // Ignore notification errors
                    }
                }
                // Schedule next occurrence for monthly/annually repeating tasks
                if (prompt.repeatType === "monthly" || prompt.repeatType === "annually") {
                    try {
                        const module = await import("./react-core.js");
                        await module.SavedPromptsService.updateAlarmForPrompt(prompt);
                    }
                    catch {
                        // Create retry alarm
                        const retryAlarmName = `retry_${alarmName}`;
                        try {
                            await chrome.alarms.create(retryAlarmName, { delayInMinutes: 1 });
                        }
                        catch {
                            // Ignore alarm creation errors
                        }
                        try {
                            await chrome.notifications.create({
                                type: "basic",
                                iconUrl: "/icon-128.png",
                                title: "Scheduled Task Setup Failed",
                                message: `Failed to schedule next occurrence of "${prompt.command || "Scheduled Task"}". Please check the task settings.`,
                                priority: 2,
                            });
                        }
                        catch {
                            // Ignore notification errors
                        }
                    }
                }
            }
        }
        catch {
            // Ignore errors
        }
        return;
    }
    // Handle retry alarms
    if (alarm.name.startsWith("retry_")) {
        try {
            const originalAlarmName = alarm.name.replace("retry_", "");
            const storage = await chrome.storage.local.get(["savedPrompts"]);
            const prompts = storage.savedPrompts || [];
            const prompt = prompts.find((p) => p.id === originalAlarmName);
            if (prompt && (prompt.repeatType === "monthly" || prompt.repeatType === "annually")) {
                try {
                    const module = await import("./react-core.js");
                    await module.SavedPromptsService.updateAlarmForPrompt(prompt);
                }
                catch {
                    try {
                        await chrome.notifications.create({
                            type: "basic",
                            iconUrl: "/icon-128.png",
                            title: "Scheduled Task Needs Attention",
                            message: `Could not automatically reschedule "${prompt.command || "Scheduled Task"}". Please edit the task to reschedule it.`,
                            priority: 2,
                        });
                    }
                    catch {
                        // Ignore notification errors
                    }
                }
            }
        }
        catch {
            // Ignore errors
        }
    }
});
// =============================================================================
// External Message Handler
// =============================================================================
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    (async () => {
        const origin = sender.origin;
        // Only accept messages from trusted origins
        if (!origin || !["https://claude.ai"].includes(origin)) {
            sendResponse({ success: false, error: "Untrusted origin" });
            return;
        }
        // Handle OAuth redirect
        if (message.type === "oauth_redirect") {
            const result = await handleOAuthRedirect(message.redirect_uri, sender?.tab?.id);
            sendResponse(result);
            if (result.success) {
                void connectToNativeHost();
            }
            return;
        }
        // Handle ping
        if (message.type === "ping") {
            sendResponse({ success: true, exists: true });
            return;
        }
        // Handle onboarding task
        if (message.type === "onboarding_task") {
            chrome.runtime.sendMessage({
                type: "POPULATE_INPUT_TEXT",
                prompt: message.payload?.prompt,
            });
            sendResponse({ success: true });
            return;
        }
    })();
    // Return true to indicate async response
    return true;
});
