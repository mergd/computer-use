// @ts-nocheck
/**
 * Chrome Extension Service Worker
 *
 * Handles native messaging connection to MCP server, message routing,
 * and extension lifecycle management for browser automation.
 */

import {
  s as setStorageValue, // Storage value setter utility
  S as StorageKeys, // Storage key constants enum
  h as getApiConfig, // API configuration getter
  o as openSidePanelFromTab, // Side panel opener utility
  H as handleLogout, // Logout handler
  _ as dynamicImport, // Dynamic module import utility
  I as handleOAuthRedirect, // OAuth redirect handler
  b as SavedPromptsService, // Service for managing saved prompts
} from "./storage";

import {
  L as notifyDisconnection, // Notify clients of native host disconnection
  t as TabGroupManager, // Tab group management singleton
  M as createErrorResponse, // Error response factory
  N as executeToolRequest, // Tool execution handler
} from "./mcp-tools";

// ============================================================================
// Types
// ============================================================================

/** Native messaging port type from Chrome API */
type NativePort = chrome.runtime.Port;

/** Message types received from native host */
interface NativeMessage {
  type: string;
  method?: string;
  params?: ToolRequestParams;
  value?: boolean;
}

/** Parameters for tool execution requests */
interface ToolRequestParams {
  tool?: string;
  args?: Record<string, unknown>;
  client_id?: string;
}

/** Tool response structure */
interface ToolResponse {
  content?: string | ContentItem[];
  is_error?: boolean;
}

/** Content item in tool responses */
interface ContentItem {
  text?: string;
  [key: string]: unknown;
}

/** Native host status */
interface NativeHostStatus {
  nativeHostInstalled: boolean;
  mcpConnected: boolean;
}

/** Chrome tab type */
type ChromeTab = chrome.tabs.Tab;

/** Message sender type */
type MessageSender = chrome.runtime.MessageSender;

/** Send response callback */
type SendResponseCallback = (response?: unknown) => void;

/** Scheduled task configuration */
interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  url?: string;
  enabled: boolean;
  skipPermissions?: boolean;
  model?: string;
}

/** Saved prompt with scheduling */
interface SavedPrompt {
  id: string;
  command?: string;
  prompt: string;
  url?: string;
  repeatType?: string;
  skipPermissions?: boolean;
  model?: string;
}

/** Main tab aliveness cache entry */
interface MainTabAlivenessEntry {
  timestamp: number;
  isAlive: boolean;
}

// ============================================================================
// Native Messaging Connection State
// ============================================================================

/** Active native messaging port connection */
let nativePort: NativePort | null = null;

/** Name of the currently connected native host */
let connectedHostName: string | null = null;

/** Flag indicating if connection is in progress */
let isConnecting = false;

/** Flag indicating if native host is installed */
let isNativeHostInstalled = false;

/** Flag indicating if MCP server is connected */
let isMcpConnected = false;

// ============================================================================
// Status Request Handling
// ============================================================================

/** Promise resolver for pending status request */
let statusResolve: ((status: NativeHostStatus) => void) | null = null;

/** Timeout ID for status request */
let statusTimeout: ReturnType<typeof setTimeout> | null = null;

// ============================================================================
// Native Messaging Functions
// ============================================================================

/**
 * Handle native messaging errors, detecting if the host is not found
 */
function handleNativeMessagingError(errorMessage: string | undefined): void {
  if (errorMessage?.includes("native messaging host not found")) {
    isNativeHostInstalled = false;
  }
}

/**
 * Attempt to connect to the native messaging host.
 * Tries multiple host configurations in order of priority.
 */
async function connectToNativeHost(): Promise<boolean> {
  try {
    return await (async function attemptConnection(): Promise<boolean> {
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
            const connectionSuccessful = await new Promise<boolean>((resolve) => {
              let resolved = false;

              const handleDisconnect = (): void => {
                if (!resolved) {
                  resolved = true;
                  // Clear any error from lastError
                  chrome.runtime.lastError;
                  resolve(false);
                }
              };

              const handleMessage = (message: { type?: string }): void => {
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
              } catch {
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
              connectedHostName = hostConfig.name;
              isNativeHostInstalled = true;

              // Set up message handler for incoming messages
              nativePort.onMessage.addListener(async (message: NativeMessage) => {
                await handleNativeMessage(message);
              });

              // Set up disconnect handler
              nativePort.onDisconnect.addListener(() => {
                const errorMessage = chrome.runtime.lastError?.message;
                nativePort = null;
                connectedHostName = null;
                isMcpConnected = false;
                setStorageValue(StorageKeys.MCP_CONNECTED, false);
                handleNativeMessagingError(errorMessage);
                notifyDisconnection();
              });

              // Request initial status
              nativePort.postMessage({ type: "get_status" });
              return true;
            }

            // This host didn't work, disconnect and try next
            port.disconnect();
          } catch {
            // Continue to next host configuration
          }
        }

        // No host configuration worked
        return false;
      } catch (error) {
        if (error instanceof Error) {
          handleNativeMessagingError(error.message);
        }
        return false;
      } finally {
        isConnecting = false;
      }
    })();
  } catch {
    return false;
  }
}

/**
 * Disconnect from native host and revoke permissions
 */
async function disconnectNativeHost(): Promise<boolean> {
  try {
    await chrome.permissions.remove({ permissions: ["nativeMessaging"] });
    nativePort?.disconnect();
    nativePort = null;
    connectedHostName = null;
    isConnecting = false;
    isNativeHostInstalled = false;
    isMcpConnected = false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Handle incoming messages from native host
 */
async function handleNativeMessage(message: NativeMessage): Promise<void> {
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
      (self as unknown as { __skipPermissions: boolean }).__skipPermissions = !!message.value;
      break;

    case "mcp_disconnected":
      isMcpConnected = false;
      setStorageValue(StorageKeys.MCP_CONNECTED, false);
      TabGroupManager.stopTabGroupChangeListener();
      break;
  }
}

/**
 * Handle tool execution request from native host
 */
async function handleToolRequest(request: NativeMessage): Promise<void> {
  try {
    const { method, params } = request;

    if (method === "execute_tool") {
      if (!params?.tool) {
        sendToolResponse(createErrorResponse("No tool specified"));
        return;
      }

      const clientId = params.client_id;
      const tabGroupId = params.args?.tabGroupId;
      const validatedTabGroupId =
        typeof tabGroupId === "number" ? tabGroupId : undefined;
      const tabId = params.args?.tabId;
      const validatedTabId = typeof tabId === "number" ? tabId : undefined;

      const toolName = params.tool;

      // Handle clipboard_read tool
      if (toolName === "clipboard_read") {
        try {
          const text = await navigator.clipboard.readText();
          sendToolResponse({ content: text }, clientId);
        } catch (err) {
          sendToolResponse(createErrorResponse((err as Error).message), clientId);
        }
        return;
      }

      // Handle clipboard_write tool
      if (toolName === "clipboard_write") {
        try {
          await navigator.clipboard.writeText((params.args?.text as string) || "");
          sendToolResponse({ content: "Text copied to clipboard" }, clientId);
        } catch (err) {
          sendToolResponse(createErrorResponse((err as Error).message), clientId);
        }
        return;
      }

      // Handle get_cookies tool
      if (toolName === "get_cookies") {
        try {
          const cookies = await chrome.cookies.getAll({
            url: params.args?.url as string,
          });
          const filtered = params.args?.name
            ? cookies.filter((c) => c.name === params.args?.name)
            : cookies;
          sendToolResponse(
            { content: JSON.stringify(filtered, null, 2) },
            clientId
          );
        } catch (err) {
          sendToolResponse(createErrorResponse((err as Error).message), clientId);
        }
        return;
      }

      // Handle set_cookie tool
      if (toolName === "set_cookie") {
        try {
          const cookieOptions: chrome.cookies.SetDetails = {
            url: params.args?.url as string,
            name: params.args?.name as string,
            value: params.args?.value as string,
          };
          if (params.args?.domain) cookieOptions.domain = params.args.domain as string;
          if (params.args?.path) cookieOptions.path = params.args.path as string;
          if (params.args?.secure) cookieOptions.secure = params.args.secure as boolean;
          if (params.args?.httpOnly) cookieOptions.httpOnly = params.args.httpOnly as boolean;
          if (params.args?.expirationDate)
            cookieOptions.expirationDate = params.args.expirationDate as number;
          const cookie = await chrome.cookies.set(cookieOptions);
          sendToolResponse(
            { content: JSON.stringify(cookie, null, 2) },
            clientId
          );
        } catch (err) {
          sendToolResponse(createErrorResponse((err as Error).message), clientId);
        }
        return;
      }

      // Handle delete_cookie tool
      if (toolName === "delete_cookie") {
        try {
          await chrome.cookies.remove({
            url: params.args?.url as string,
            name: params.args?.name as string,
          });
          sendToolResponse({ content: "Cookie deleted" }, clientId);
        } catch (err) {
          sendToolResponse(createErrorResponse((err as Error).message), clientId);
        }
        return;
      }

      // Handle search_history tool
      if (toolName === "search_history") {
        try {
          const historyOptions: chrome.history.HistoryQuery = {
            text: (params.args?.query as string) || "",
            maxResults: (params.args?.maxResults as number) || 100,
          };
          if (params.args?.startTime) historyOptions.startTime = params.args.startTime as number;
          if (params.args?.endTime) historyOptions.endTime = params.args.endTime as number;
          const results = await chrome.history.search(historyOptions);
          sendToolResponse(
            { content: JSON.stringify(results, null, 2) },
            clientId
          );
        } catch (err) {
          sendToolResponse(createErrorResponse((err as Error).message), clientId);
        }
        return;
      }

      // Handle other tools through the general tool executor
      sendToolResponse(
        await executeToolRequest({
          toolName: params.tool,
          args: params.args || {},
          tabId: validatedTabId,
          tabGroupId: validatedTabGroupId,
          clientId: clientId,
        }),
        clientId
      );
    } else {
      sendToolResponse({ content: `Unknown method: ${method}` });
    }
  } catch (error) {
    sendToolResponse(
      createErrorResponse(
        `Tool execution failed: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    );
  }
}

/**
 * Handle MCP connected event
 */
function handleMcpConnected(): void {
  isMcpConnected = true;
  setStorageValue(StorageKeys.MCP_CONNECTED, true);
  TabGroupManager.initialize();
  TabGroupManager.startTabGroupChangeListener();
}

/**
 * Enhance error message for permission denials
 */
function enhancePermissionDenialMessage(
  content: string | ContentItem[]
): { type: string; error: { content: string | ContentItem[] } } {
  let enhancedContent: string | ContentItem[];
  const permissionDenialSuffix =
    "IMPORTANT: The user has explicitly declined this action. Do not attempt to use other tools or workarounds. Instead, acknowledge the denial and ask the user how they would prefer to proceed.";

  if (typeof content === "string") {
    if (content.includes("Permission denied by user")) {
      enhancedContent = `${content} - ${permissionDenialSuffix}`;
    } else {
      enhancedContent = content;
    }
  } else {
    // Handle array of content items
    enhancedContent = content.map((item) => {
      if (
        typeof item === "object" &&
        item !== null &&
        "text" in item &&
        typeof item.text === "string" &&
        item.text.includes("Permission denied by user")
      ) {
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
function sendToolResponse(
  { content, is_error }: ToolResponse,
  clientId?: string
): void {
  if (!nativePort) {
    return;
  }

  if (!content || (typeof content !== "string" && !Array.isArray(content))) {
    return;
  }

  let response;
  if (is_error) {
    response = enhancePermissionDenialMessage(content);
  } else {
    response = { type: "tool_response", result: { content: content } };
  }

  nativePort.postMessage(response);
}

// ============================================================================
// Network Request Rules
// ============================================================================

/**
 * Set up declarative net request rules for API requests
 */
async function setupNetRequestRules(): Promise<void> {
  const apiConfig = getApiConfig();
  const userAgent = `claude-browser-extension/${chrome.runtime.getManifest().version} (external) ${navigator.userAgent}`;

  const rules: chrome.declarativeNetRequest.Rule[] = [
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

// ============================================================================
// Extension URL Handling
// ============================================================================

/** Extension URL handling path prefix */
const EXTENSION_URL_PREFIX = "/chrome/";

/**
 * Handle extension-specific URLs (clau.de/chrome/*)
 */
async function handleExtensionUrl(url: string, tabId: number): Promise<boolean> {
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
  } catch {
    return false;
  }
}

/**
 * Handle /chrome/permissions URL
 */
async function handlePermissionsUrl(tabId: number): Promise<void> {
  try {
    const optionsUrl = chrome.runtime.getURL("options.html#permissions");
    await chrome.tabs.create({ url: optionsUrl });
  } catch {
    // Ignore errors
  } finally {
    await closeTab(tabId);
  }
}

/**
 * Handle /chrome/reconnect URL
 */
async function handleReconnectUrl(tabId: number): Promise<void> {
  try {
    await disconnectNativeHost();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await connectToNativeHost();
  } catch {
    // Reconnect failed
  } finally {
    await closeTab(tabId);
  }
}

/**
 * Handle /chrome/tab/* URL for switching tabs
 */
async function handleTabSwitchUrl(
  targetTabId: number,
  currentTabId: number
): Promise<boolean> {
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
  } catch {
    await closeTab(currentTabId);
    return true;
  }
}

/**
 * Close a tab by ID, silently ignoring errors
 */
async function closeTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // Ignore errors when closing tabs
  }
}

// ============================================================================
// Scheduled Prompts
// ============================================================================

/**
 * Initialize alarms for scheduled prompts
 */
async function initializeScheduledPromptAlarms(): Promise<void> {
  try {
    const allPrompts = await SavedPromptsService.getAllPrompts();
    const repeatingPrompts = allPrompts.filter(
      (prompt: SavedPrompt) => prompt.repeatType && prompt.repeatType !== "none"
    );

    if (repeatingPrompts.length === 0) {
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const prompt of repeatingPrompts) {
      try {
        await SavedPromptsService.updateAlarmForPrompt(prompt);
        successCount++;
      } catch {
        failCount++;
      }
    }

    try {
      await SavedPromptsService.updateNextRunTimes();
    } catch {
      // Ignore errors
    }
  } catch {
    // Ignore errors
  }
}

// ============================================================================
// Extension Initialization
// ============================================================================

/** Initialize extension (placeholder for future initialization logic) */
const initializeExtension = (): void => {};

// Initialize extension
initializeExtension();
connectToNativeHost();

// ============================================================================
// Tab Group Management
// ============================================================================

/** Cache for main tab aliveness checks */
const mainTabAlivenessCache = new Map<number, MainTabAlivenessEntry>();

/**
 * Ensure a tab is part of a managed group, creating one if needed
 */
async function ensureTabInManagedGroup(tabId: number): Promise<void> {
  await TabGroupManager.initialize(true);
  const group = await TabGroupManager.findGroupByTab(tabId);

  if (group) {
    if (group.isUnmanaged) {
      try {
        await TabGroupManager.adoptOrphanedGroup(tabId, group.chromeGroupId);
      } catch {
        // Ignore errors
      }
      return;
    }
  } else {
    try {
      await TabGroupManager.createGroup(tabId);
    } catch {
      // Ignore errors
    }
    connectToNativeHost();
  }
}

/**
 * Handle action button click on a tab
 */
async function handleActionClick(tab: ChromeTab): Promise<void> {
  const tabId = tab.id;
  if (tabId) {
    await ensureTabInManagedGroup(tabId);
  }
}

/**
 * Create a new window and group for a scheduled task
 */
async function executeScheduledTaskInNewWindow(
  task: ScheduledTask,
  runLogId: string
): Promise<void> {
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

// ============================================================================
// Extension Lifecycle Event Handlers
// ============================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  chrome.storage.local.remove(["updateAvailable"]);
  await TabGroupManager.initialize();
  await setupNetRequestRules();
  connectToNativeHost();
  await initializeScheduledPromptAlarms();
});

chrome.runtime.onStartup.addListener(async () => {
  await setupNetRequestRules();
  await TabGroupManager.initialize();
  connectToNativeHost();
  await initializeScheduledPromptAlarms();
});

chrome.permissions.onAdded.addListener((permissions) => {
  if (permissions.permissions?.includes("nativeMessaging")) {
    connectToNativeHost();
  }
});

chrome.permissions.onRemoved.addListener((permissions) => {
  if (permissions.permissions?.includes("nativeMessaging")) {
    disconnectNativeHost();
  }
});

chrome.action.onClicked.addListener(handleActionClick);

chrome.notifications.onClicked.addListener(async (notificationId) => {
  chrome.notifications.clear(notificationId);

  const parts = notificationId.split("_");
  let tabId: number | null = null;

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
    } catch {
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
        handleActionClick(activeTab);
      }
    });
  }
});

chrome.runtime.onUpdateAvailable.addListener((details) => {
  setStorageValue(StorageKeys.UPDATE_AVAILABLE, true);
});

// ============================================================================
// Message Handlers
// ============================================================================

chrome.runtime.onMessage.addListener(
  (message: Record<string, unknown>, sender: MessageSender, sendResponse: SendResponseCallback) => {
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
        } catch (error) {
          sendResponse({ success: false, error: (error as Error).message });
        }
        return;
      }

      // Handle open side panel request
      if (message.type === "open_side_panel") {
        const tabId = (message.tabId as number) || sender.tab?.id;
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
          await retryLoadConversation(message.conversationUuid as string);
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
        } catch {
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
        const success = sendMcpNotification(
          message.method as string,
          message.params as Record<string, unknown>
        );
        sendResponse({ success: success });
        return;
      }

      // Handle opening options with a scheduled task
      if (message.type === "OPEN_OPTIONS_WITH_TASK") {
        try {
          await setStorageValue(StorageKeys.PENDING_SCHEDULED_TASK, message.task);
          const optionsUrl = chrome.runtime.getURL("options.html");
          const allTabs = await chrome.tabs.query({});
          const existingOptionsTab = allTabs.find((tab) =>
            tab.url?.startsWith(optionsUrl)
          );

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
          } else {
            await chrome.tabs.create({
              url: chrome.runtime.getURL("options.html#prompts"),
            });
          }
          sendResponse({ success: true });
        } catch (error) {
          sendResponse({ success: false, error: (error as Error).message });
        }
        return;
      }

      // Handle scheduled task execution
      if (message.type === "EXECUTE_SCHEDULED_TASK") {
        try {
          const { task, runLogId } = message as { task: ScheduledTask; runLogId: string };
          await executeScheduledTaskInNewWindow(task, runLogId);
          sendResponse({ success: true });
        } catch (error) {
          sendResponse({ success: false, error: (error as Error).message });
        }
        return;
      }

      // Handle stop agent request
      if (message.type === "STOP_AGENT") {
        let targetTabId: number | undefined;
        if (message.fromTabId === "CURRENT_TAB" && sender.tab?.id) {
          targetTabId =
            (await TabGroupManager.getMainTabId(sender.tab.id)) || sender.tab.id;
        } else if (typeof message.fromTabId === "number") {
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
          } else {
            sendResponse({ success: false, error: "No main tab found" });
          }
        } catch (error) {
          sendResponse({ success: false, error: (error as Error).message });
        }
        return;
      }

      // Handle secondary tab checking main tab status
      if (message.type === "SECONDARY_TAB_CHECK_MAIN") {
        chrome.runtime.sendMessage(
          {
            type: "MAIN_TAB_ACK_REQUEST",
            secondaryTabId: message.secondaryTabId,
            mainTabId: message.mainTabId,
            timestamp: message.timestamp,
          },
          (response) => {
            sendResponse((response as { success?: boolean })?.success ? { success: true } : { success: false });
          }
        );
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
  }
);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create offscreen document for audio playback
 */
async function createOffscreenDocument(): Promise<void> {
  if (!chrome.offscreen) {
    return;
  }

  try {
    // Close any existing offscreen document
    try {
      await chrome.offscreen.closeDocument();
    } catch {
      // Ignore errors
    }

    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: "Play notification sounds when user is on different tab",
    });
  } catch (error) {
    throw error;
  }
}

/**
 * Retry populating the input text with exponential backoff
 */
async function retryPopulateInput(
  message: Record<string, unknown>,
  attempt = 0
): Promise<void> {
  try {
    const delay = attempt === 0 ? 800 : 500;
    await new Promise((resolve) => setTimeout(resolve, delay));

    await new Promise<void>((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: "POPULATE_INPUT_TEXT",
          prompt: message.prompt,
          permissionMode: message.permissionMode,
          selectedModel: message.selectedModel,
          attachments: message.attachments,
        },
        () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        }
      );
    });
  } catch {
    if (attempt < 5) {
      await retryPopulateInput(message, attempt + 1);
    }
  }
}

/**
 * Retry loading a conversation with exponential backoff
 */
async function retryLoadConversation(
  conversationUuid: string,
  attempt = 0
): Promise<void> {
  try {
    const delay = attempt === 0 ? 800 : 500;
    await new Promise((resolve) => setTimeout(resolve, delay));

    await new Promise<void>((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: "LOAD_CONVERSATION",
          conversationUuid: conversationUuid,
        },
        () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        }
      );
    });
  } catch {
    if (attempt < 5) {
      await retryLoadConversation(conversationUuid, attempt + 1);
    }
  }
}

/**
 * Get current native host connection status
 */
async function getNativeHostStatus(): Promise<NativeHostStatus> {
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
    nativePort!.postMessage({ type: "get_status" });

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
function sendMcpNotification(
  method: string,
  params?: Record<string, unknown>
): boolean {
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

/**
 * Handle static indicator heartbeat check
 */
async function handleStaticIndicatorHeartbeat(
  sender: MessageSender,
  sendResponse: SendResponseCallback
): Promise<void> {
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
    const checkTabForMainTab = async (index: number): Promise<void> => {
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
        } else {
          await checkTabForMainTab(index + 1);
        }
        return;
      }

      // Check if this tab is a main tab
      chrome.runtime.sendMessage(
        {
          type: "MAIN_TAB_ACK_REQUEST",
          secondaryTabId: senderTabId,
          mainTabId: candidateTabId,
          timestamp: now,
        },
        async (response) => {
          const isAlive = (response as { success?: boolean })?.success ?? false;
          mainTabAlivenessCache.set(candidateTabId, {
            timestamp: now,
            isAlive: isAlive,
          });

          if (isAlive) {
            sendResponse({ success: true });
          } else {
            await checkTabForMainTab(index + 1);
          }
        }
      );
    };

    await checkTabForMainTab(0);
  } catch {
    sendResponse({ success: false });
  }
}

/**
 * Handle dismissing static indicators for a tab group
 */
async function handleDismissStaticIndicator(
  sender: MessageSender,
  sendResponse: SendResponseCallback
): Promise<void> {
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
  } catch {
    sendResponse({ success: false });
  }
}

// ============================================================================
// Event Listeners
// ============================================================================

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

// Alarm handler for scheduled tasks
chrome.alarms.onAlarm.addListener(async (alarm) => {
  // Handle prompt alarms
  if (alarm.name.startsWith("prompt_")) {
    try {
      const alarmName = alarm.name;
      const storage = await chrome.storage.local.get(["savedPrompts"]);
      const prompts: SavedPrompt[] = storage.savedPrompts || [];
      const prompt = prompts.find((p) => p.id === alarmName);

      if (prompt) {
        const runLogId = `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        let executionError: Error | null = null;

        try {
          const task: ScheduledTask = {
            id: prompt.id,
            name: prompt.command || "Scheduled Task",
            prompt: prompt.prompt,
            url: prompt.url,
            enabled: true,
            skipPermissions: prompt.skipPermissions !== false,
            model: prompt.model,
          };
          await executeScheduledTaskInNewWindow(task, runLogId);
        } catch (error) {
          executionError = error instanceof Error ? error : new Error(String(error));

          try {
            await chrome.notifications.create({
              type: "basic",
              iconUrl: "/icon-128.png",
              title: "Scheduled Task Failed",
              message: `Task "${prompt.command || "Scheduled Task"}" failed to execute. ${executionError.message}`,
              priority: 2,
            });
          } catch {
            // Ignore notification errors
          }
        }

        // Schedule next occurrence for monthly/annually repeating tasks
        if (prompt.repeatType === "monthly" || prompt.repeatType === "annually") {
          try {
            const { SavedPromptsService: DynamicSavedPromptsService } = await dynamicImport(async () => {
              const module = await import("./storage");
              return { SavedPromptsService: (module as { N: { SavedPromptsService: typeof SavedPromptsService } }).N.SavedPromptsService };
            }, []);
            await DynamicSavedPromptsService.updateAlarmForPrompt(prompt);
          } catch {
            // Create retry alarm
            const retryAlarmName = `retry_${alarmName}`;
            try {
              await chrome.alarms.create(retryAlarmName, { delayInMinutes: 1 });
            } catch {
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
            } catch {
              // Ignore notification errors
            }
          }
        }
      }
    } catch {
      // Ignore errors
    }
    return;
  }

  // Handle retry alarms
  if (alarm.name.startsWith("retry_")) {
    try {
      const originalAlarmName = alarm.name.replace("retry_", "");
      const storage = await chrome.storage.local.get(["savedPrompts"]);
      const prompts: SavedPrompt[] = storage.savedPrompts || [];
      const prompt = prompts.find((p) => p.id === originalAlarmName);

      if (prompt && (prompt.repeatType === "monthly" || prompt.repeatType === "annually")) {
        try {
          const { SavedPromptsService: DynamicSavedPromptsService } = await dynamicImport(async () => {
            const module = await import("./storage");
            return { SavedPromptsService: (module as { N: { SavedPromptsService: typeof SavedPromptsService } }).N.SavedPromptsService };
          }, []);
          await DynamicSavedPromptsService.updateAlarmForPrompt(prompt);
        } catch {
          try {
            await chrome.notifications.create({
              type: "basic",
              iconUrl: "/icon-128.png",
              title: "Scheduled Task Needs Attention",
              message: `Could not automatically reschedule "${prompt.command || "Scheduled Task"}". Please edit the task to reschedule it.`,
              priority: 2,
            });
          } catch {
            // Ignore notification errors
          }
        }
      }
    } catch {
      // Ignore errors
    }
  }
});

// External message handler for OAuth and other cross-origin communication
chrome.runtime.onMessageExternal.addListener(
  (message: Record<string, unknown>, sender: MessageSender, sendResponse: SendResponseCallback) => {
    (async () => {
      const origin = sender.origin;

      // Only accept messages from trusted origins
      if (!origin || !["https://claude.ai"].includes(origin)) {
        sendResponse({ success: false, error: "Untrusted origin" });
        return;
      }

      // Handle OAuth redirect
      if (message.type === "oauth_redirect") {
        const result = await handleOAuthRedirect(
          message.redirect_uri as string,
          sender?.tab?.id
        );
        sendResponse(result);
        if ((result as { success?: boolean }).success) {
          connectToNativeHost();
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
          prompt: (message.payload as { prompt?: string })?.prompt,
        });
        sendResponse({ success: true });
        return;
      }
    })();

    // Return true to indicate async response
    return true;
  }
);
