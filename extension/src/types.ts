/**
 * types.ts - Shared TypeScript type definitions for MCP tools modules
 *
 * This file contains all shared type definitions used across the extension's
 * tool modules including tool parameters, results, permissions, and contexts.
 */

// =============================================================================
// Tool Permission Types
// =============================================================================

/**
 * Tool permission type enumeration - maps to specific tool actions
 */
export type ToolPermissionType =
  | "navigate"
  | "read_page_content"
  | "read_console_messages"
  | "read_network_requests"
  | "click"
  | "type"
  | "upload_image"
  | "domain_transition"
  | "plan_approval"
  | "execute_javascript"
  | "remote_mcp";

/**
 * Permission check result from PermissionManager
 */
export interface PermissionCheckResult {
  allowed: boolean;
  needsPrompt: boolean;
}

/**
 * Permission manager interface
 */
export interface PermissionManager {
  checkPermission(url: string, toolUseId: string | undefined): Promise<PermissionCheckResult>;
}

// =============================================================================
// Tab Types
// =============================================================================

/**
 * Basic tab information for context responses
 */
export interface TabInfo {
  id: number | undefined;
  title: string;
  url: string;
}

/**
 * Tab metadata with tab ID guaranteed
 */
export interface TabMetadata {
  id: number;
  title: string;
  url: string;
}

/**
 * Tab context included in tool results
 */
export interface TabContext {
  currentTabId: number;
  executedOnTabId?: number;
  availableTabs: TabMetadata[];
  tabCount: number;
  tabGroupId?: number;
}

/**
 * Tab group information from TabGroupManager
 */
export interface TabGroup {
  mainTabId: number;
  secondaryTabIds?: number[];
  tabGroupId?: number;
}

/**
 * MCP tab context returned by tabs_context_mcp
 */
export interface McpTabContext {
  tabGroupId: number;
  availableTabs: TabMetadata[];
  initialTabId?: number;
}

// =============================================================================
// Tool Result Types
// =============================================================================

/**
 * Base successful tool result
 */
export interface ToolResultSuccess {
  output?: string;
  error?: undefined;
  tabContext?: TabContext;
  base64Image?: string;
  imageFormat?: string;
  imageId?: string;
}

/**
 * Tool result with error
 */
export interface ToolResultError {
  error: string;
  output?: undefined;
  tabContext?: TabContext;
}

/**
 * Permission required result - returned when tool needs permission
 */
export interface PermissionRequiredResult {
  type: "permission_required";
  tool: ToolPermissionType;
  url: string;
  toolUseId: string | undefined;
  actionData?: Record<string, unknown>;
}

/**
 * Union of all possible tool execution results
 */
export type ToolResult = ToolResultSuccess | ToolResultError | PermissionRequiredResult;

/**
 * Type guard to check if result is a permission request
 */
export function isPermissionRequired(result: ToolResult): result is PermissionRequiredResult {
  return "type" in result && result.type === "permission_required";
}

/**
 * Type guard to check if result is an error
 */
export function isToolError(result: ToolResult): result is ToolResultError {
  return "error" in result && result.error !== undefined;
}

// =============================================================================
// Tool Execution Context
// =============================================================================

/**
 * Context passed to tool execute functions
 */
export interface ToolExecutionContext {
  toolUseId: string | undefined;
  tabId: number | undefined;
  tabGroupId?: number;
  model?: string;
  sessionId: string;
  permissionManager: PermissionManager;
  messages?: Message[];
  analytics?: Analytics;
}

/**
 * Context for ToolCallHandler
 */
export interface ToolCallHandlerContext extends ToolExecutionContext {
  onPermissionRequired?: (
    permRequest: PermissionRequiredResult,
    tabId: number
  ) => Promise<boolean>;
}

/**
 * Analytics interface (optional)
 */
export interface Analytics {
  track(event: string, data: Record<string, unknown>): void;
}

// =============================================================================
// Tool Definition Types
// =============================================================================

/**
 * Tool parameter schema definition
 */
export interface ToolParameterSchema {
  type: string | string[];
  description?: string;
  enum?: string[];
  items?: { type: string };
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  required?: boolean;
  properties?: Record<string, ToolParameterSchema>;
}

/**
 * Anthropic input schema format
 */
export interface AnthropicInputSchema {
  type: "object";
  properties: Record<string, ToolParameterSchema>;
  required?: string[];
}

/**
 * Anthropic tool schema format
 */
export interface AnthropicToolSchema {
  name: string;
  description: string;
  input_schema: AnthropicInputSchema;
  type?: "custom";
}

/**
 * Tool definition interface
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameterSchema>;
  execute(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult>;
  toAnthropicSchema(context?: unknown): Promise<AnthropicToolSchema> | AnthropicToolSchema;
  setPromptsConfig?(config: PromptsConfig): void;
}

/**
 * Configuration for tool prompts (used by update_plan)
 */
export interface PromptsConfig {
  toolDescription?: string;
  inputPropertyDescriptions?: Record<string, string>;
}

// =============================================================================
// Tool Call Types
// =============================================================================

/**
 * Tool call from API
 */
export interface ToolCall {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Tool result content item - text
 */
export interface ToolResultTextContent {
  type: "text";
  text: string;
}

/**
 * Tool result content item - image
 */
export interface ToolResultImageContent {
  type: "image";
  source: {
    type: "base64";
    media_type: string;
    data: string;
  };
}

/**
 * Tool result content union
 */
export type ToolResultContent = ToolResultTextContent | ToolResultImageContent;

/**
 * Formatted tool result for API response
 */
export interface FormattedToolResult {
  type: "tool_result";
  tool_use_id: string;
  content: ToolResultContent[] | string;
  is_error?: boolean;
}

// =============================================================================
// Message Types (for image finding)
// =============================================================================

/**
 * Text content in a message
 */
export interface TextContent {
  type: "text";
  text: string;
}

/**
 * Image content in a message
 */
export interface ImageContent {
  type: "image";
  source: {
    type: "base64";
    data: string;
    media_type?: string;
  };
}

/**
 * Tool result content in a message
 */
export interface ToolResultMessageContent {
  type: "tool_result";
  tool_use_id: string;
  content?: (TextContent | ImageContent)[] | string;
}

/**
 * Message content union
 */
export type MessageContent = TextContent | ImageContent | ToolResultMessageContent;

/**
 * Message in conversation history
 */
export interface Message {
  role: "user" | "assistant";
  content: MessageContent[] | string;
}

/**
 * Image data extracted from messages
 */
export interface ImageData {
  base64: string;
  width?: number;
  height?: number;
}

// =============================================================================
// Computer Tool Types
// =============================================================================

/**
 * Computer tool action types
 */
export type ComputerAction =
  | "left_click"
  | "right_click"
  | "double_click"
  | "triple_click"
  | "type"
  | "screenshot"
  | "wait"
  | "scroll"
  | "key"
  | "left_click_drag"
  | "zoom"
  | "scroll_to"
  | "hover";

/**
 * Scroll direction
 */
export type ScrollDirection = "up" | "down" | "left" | "right";

/**
 * Computer tool parameters
 */
export interface ComputerToolParams {
  action: ComputerAction;
  coordinate?: [number, number];
  text?: string;
  duration?: number;
  scroll_direction?: ScrollDirection;
  scroll_amount?: number;
  start_coordinate?: [number, number];
  region?: [number, number, number, number];
  repeat?: number;
  ref?: string;
  modifiers?: string;
  tabId?: number;
}

/**
 * Viewport context for coordinate scaling
 */
export interface ViewportContext {
  viewportWidth: number;
  viewportHeight: number;
  screenshotWidth: number;
  screenshotHeight: number;
}

/**
 * Element coordinates result
 */
export interface ElementCoordinatesResult {
  success: boolean;
  coordinates?: [number, number];
  error?: string;
}

// =============================================================================
// Screenshot Types
// =============================================================================

/**
 * Screenshot result from CDP
 */
export interface ScreenshotResult {
  base64: string;
  width: number;
  height: number;
  format: string;
  viewportWidth?: number;
  viewportHeight?: number;
}

// =============================================================================
// GIF Recording Types
// =============================================================================

/**
 * GIF action types
 */
export type GifAction = "start_recording" | "stop_recording" | "export" | "clear";

/**
 * Action info stored with GIF frames
 */
export interface GifActionInfo {
  type: string;
  coordinate?: [number, number];
  start_coordinate?: [number, number];
  text?: string;
  timestamp: number;
  description?: string;
}

/**
 * GIF frame data
 */
export interface GifFrame {
  base64: string;
  action?: GifActionInfo;
  frameNumber: number;
  timestamp: number;
  viewportWidth?: number;
  viewportHeight?: number;
  devicePixelRatio?: number;
}

/**
 * GIF export options
 */
export interface GifExportOptions {
  showClickIndicators?: boolean;
  showDragPaths?: boolean;
  showActionLabels?: boolean;
  showProgressBar?: boolean;
  showWatermark?: boolean;
  quality?: number;
}

/**
 * GIF creator tool parameters
 */
export interface GifCreatorParams {
  action: GifAction;
  tabId: number;
  coordinate?: [number, number];
  download?: boolean;
  filename?: string;
  options?: GifExportOptions;
}

/**
 * GIF generation result from offscreen
 */
export interface GifGenerationResult {
  base64: string;
  blobUrl: string;
  size: number;
  width: number;
  height: number;
}

// =============================================================================
// Navigation Types
// =============================================================================

/**
 * Navigate tool parameters
 */
export interface NavigateParams {
  url: string;
  tabId?: number;
}

/**
 * Domain change detection result
 */
export interface DomainChange {
  oldDomain: string;
  newDomain: string;
}

/**
 * Domain category result
 */
export type DomainCategory =
  | "category1"
  | "category2"
  | "category_org_blocked"
  | string
  | null;

// =============================================================================
// Page Tool Types
// =============================================================================

/**
 * Read page tool parameters
 */
export interface ReadPageParams {
  filter?: "interactive" | "all";
  tabId?: number;
  depth?: number;
  ref_id?: string;
  max_chars?: number;
}

/**
 * Form input tool parameters
 */
export interface FormInputParams {
  ref: string;
  value: string | boolean | number;
  tabId?: number;
}

/**
 * Get page text parameters
 */
export interface GetPageTextParams {
  tabId?: number;
  max_chars?: number;
}

/**
 * JavaScript tool parameters
 */
export interface JavaScriptToolParams {
  action: "javascript_exec";
  text: string;
  tabId?: number;
}

/**
 * Accessibility tree result
 */
export interface AccessibilityTreeResult {
  pageContent: string;
  viewport: {
    width: number;
    height: number;
  };
  error?: string;
}

// =============================================================================
// Plan Tool Types
// =============================================================================

/**
 * Domain with category info for plans
 */
export interface DomainWithCategory {
  domain: string;
  category?: DomainCategory;
}

/**
 * Plan data structure
 */
export interface PlanData {
  domains: DomainWithCategory[];
  approach: string[];
}

/**
 * Update plan tool parameters
 */
export interface UpdatePlanParams {
  domains: string[];
  approach: string[];
}

// =============================================================================
// Utility Tool Types
// =============================================================================

/**
 * Upload image tool parameters
 */
export interface UploadImageParams {
  imageId: string;
  ref?: string;
  coordinate?: [number, number];
  tabId?: number;
  filename?: string;
}

/**
 * Read console messages parameters
 */
export interface ReadConsoleMessagesParams {
  tabId: number;
  onlyErrors?: boolean;
  clear?: boolean;
  pattern?: string;
  limit?: number;
}

/**
 * Console message data
 */
export interface ConsoleMessage {
  type: string;
  text: string;
  timestamp: number;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  stackTrace?: string;
}

/**
 * Read network requests parameters
 */
export interface ReadNetworkRequestsParams {
  tabId: number;
  urlPattern?: string;
  clear?: boolean;
  limit?: number;
}

/**
 * Network request data
 */
export interface NetworkRequest {
  url: string;
  method: string;
  status?: number | string;
  timestamp?: number;
}

/**
 * Resize window parameters
 */
export interface ResizeWindowParams {
  width: number;
  height: number;
  tabId: number;
}

/**
 * Shortcuts list item
 */
export interface ShortcutInfo {
  id: string;
  command?: string;
}

/**
 * Shortcuts execute parameters
 */
export interface ShortcutsExecuteParams {
  shortcutId?: string;
  command?: string;
}

// =============================================================================
// MCP Request/Response Types
// =============================================================================

/**
 * MCP tool execution request
 */
export interface McpToolRequest {
  toolName: string;
  args: Record<string, unknown>;
  tabId?: number;
  tabGroupId?: number;
  clientId?: string;
}

/**
 * MCP error response
 */
export interface McpErrorResponse {
  content: [{ type: "text"; text: string }];
  is_error: true;
}

/**
 * Active tool call tracking info
 */
export interface ActiveToolCallInfo {
  toolName: string;
  requestId: string;
  startTime: number;
  errorCallback?: (error: string) => void;
}

// =============================================================================
// Domain Transition Types
// =============================================================================

/**
 * Domain transition permission request action data
 */
export interface DomainTransitionActionData {
  fromDomain: string;
  toDomain: string;
  sourceTabId: number;
  isSecondaryTab: boolean;
  [key: string]: unknown;
}

/**
 * Domain transition permission request
 */
export interface DomainTransitionRequest extends PermissionRequiredResult {
  tool: "domain_transition";
  actionData: DomainTransitionActionData;
}

// =============================================================================
// Tab Context Check Types
// =============================================================================

/**
 * Tab context check result
 */
export interface TabContextCheckResult {
  isMainTab: boolean;
  isSecondaryTab: boolean;
  group?: TabGroup;
}

// =============================================================================
// CDP Types
// =============================================================================

/**
 * Mouse event parameters for CDP
 */
export interface MouseEventParams {
  type: "mouseMoved" | "mousePressed" | "mouseReleased";
  x: number;
  y: number;
  button: "none" | "left" | "right" | "middle";
  buttons: number;
  clickCount?: number;
  modifiers?: number;
}

/**
 * Runtime evaluate result from CDP
 */
export interface RuntimeEvaluateResult {
  result?: {
    type: string;
    subtype?: string;
    value?: unknown;
    description?: string;
  };
  exceptionDetails?: {
    exception?: {
      description?: string;
      value?: unknown;
    };
  };
}

// =============================================================================
// Window Global Extensions
// =============================================================================

/**
 * Element reference map for accessibility tree
 */
export type ClaudeElementMap = Record<string, WeakRef<Element>>;

/**
 * Accessibility tree generation function signature
 */
export type AccessibilityTreeFunction = (
  filterMode?: string | null,
  maxDepth?: number | null,
  maxChars?: number,
  refId?: string | null
) => AccessibilityTreeResult;

/**
 * Window extensions for Claude element tracking and accessibility
 */
declare global {
  interface Window {
    __claudeElementMap?: ClaudeElementMap;
    __claudeRefCounter?: number;
    __generateAccessibilityTree?: AccessibilityTreeFunction;
  }
}
