/**
 * gif-tools.js - GIF recording functionality
 *
 * Contains GIF recording and export tools:
 * - xe: GifFrameStorage class
 * - Ce: gif_creator tool
 * - Se: getActionDelay helper
 */

import { re } from "./cdp-debugger.js";
import { K } from "./tab-group-manager.js";
import { S as StorageKeys, T as ToolTypes } from "./storage.js";
import { checkNavigationInterception } from "./utils.js";

// GIF frame storage class (xe)
class GifFrameStorage {
  storage = new Map();
  recordingGroups = new Set();

  addFrame(groupId, frame) {
    if (!this.storage.has(groupId)) {
      this.storage.set(groupId, { frames: [], lastUpdated: Date.now() });
    }
    const group = this.storage.get(groupId);
    group.frames.push(frame);
    group.lastUpdated = Date.now();

    // Keep max 50 frames
    if (group.frames.length > 50) {
      group.frames.shift();
    }
  }

  getFrames(groupId) {
    return this.storage.get(groupId)?.frames ?? [];
  }

  clearFrames(groupId) {
    this.storage.get(groupId)?.frames.length;
    this.storage.delete(groupId);
    this.recordingGroups.delete(groupId);
  }

  getFrameCount(groupId) {
    return this.storage.get(groupId)?.frames.length ?? 0;
  }

  getActiveGroupIds() {
    return Array.from(this.storage.keys());
  }

  startRecording(groupId) {
    this.recordingGroups.add(groupId);
  }

  stopRecording(groupId) {
    this.recordingGroups.delete(groupId);
  }

  isRecording(groupId) {
    return this.recordingGroups.has(groupId);
  }

  getRecordingGroupIds() {
    return Array.from(this.recordingGroups);
  }

  clearAll() {
    Array.from(this.storage.values()).reduce((sum, group) => sum + group.frames.length, 0);
    this.storage.clear();
    this.recordingGroups.clear();
  }
}

// Singleton instance
export const gifFrameStorage = new GifFrameStorage();

// Get delay for action type (Se)
export function getActionDelay(actionType) {
  const delays = {
    wait: 300,
    screenshot: 300,
    navigate: 800,
    scroll: 800,
    scroll_to: 800,
    type: 800,
    key: 800,
    zoom: 800,
    left_click: 1500,
    right_click: 1500,
    double_click: 1500,
    triple_click: 1500,
    left_click_drag: 1500,
  };
  return delays[actionType] ?? 800;
}

// Handle start_recording action
async function handleStartRecording(groupId) {
  const wasRecording = gifFrameStorage.isRecording(groupId);

  if (wasRecording) {
    return {
      output:
        "Recording is already active for this tab group. Use 'stop_recording' to stop or 'export' to generate GIF.",
    };
  }

  gifFrameStorage.clearFrames(groupId);
  gifFrameStorage.startRecording(groupId);

  return {
    output:
      "Started recording browser actions for this tab group. All computer and navigate tool actions will now be captured (max 50 frames). Previous frames cleared.",
  };
}

// Handle stop_recording action
async function handleStopRecording(groupId) {
  const wasRecording = gifFrameStorage.isRecording(groupId);

  if (!wasRecording) {
    return {
      output:
        "Recording is not active for this tab group. Use 'start_recording' to begin capturing.",
    };
  }

  gifFrameStorage.stopRecording(groupId);
  const frameCount = gifFrameStorage.getFrameCount(groupId);

  return {
    output: `Stopped recording for this tab group. Captured ${frameCount} frame${frameCount === 1 ? "" : "s"}. Use 'export' to generate GIF or 'clear' to discard.`,
  };
}

// Handle export action
async function handleExport(params, tab, groupId, context) {
  const shouldDownload = params.download === true;

  if (!shouldDownload && (!params.coordinate || params.coordinate.length !== 2)) {
    throw new Error(
      "coordinate parameter is required for export action (or set download: true to download the GIF)"
    );
  }

  if (!tab.id || !tab.url) {
    throw new Error("Tab has no ID or URL");
  }

  const frames = gifFrameStorage.getFrames(groupId);
  if (frames.length === 0) {
    return {
      error:
        "No frames recorded for this tab group. Use 'start_recording' and perform browser actions first.",
    };
  }

  // Permission check for upload (not for download)
  if (!shouldDownload) {
    const url = tab.url;
    const toolUseId = context?.toolUseId;
    const permResult = await context.permissionManager.checkPermission(url, toolUseId);

    if (!permResult.allowed) {
      if (permResult.needsPrompt) {
        return {
          type: "permission_required",
          tool: ToolTypes.UPLOAD_IMAGE,
          url,
          toolUseId,
          actionData: { coordinate: params.coordinate },
        };
      }
      return { error: "Permission denied for uploading to this domain" };
    }
  }

  const originalUrl = tab.url;

  // Ensure offscreen document exists
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });

  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["BLOBS"],
      justification: "Generate animated GIF from screenshots",
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  // Prepare frames for GIF generation
  const frameData = frames.map((frame) => ({
    base64: frame.base64,
    format: "png",
    action: frame.action,
    delay: frame.action ? getActionDelay(frame.action.type) : 800,
    viewportWidth: frame.viewportWidth,
    viewportHeight: frame.viewportHeight,
    devicePixelRatio: frame.devicePixelRatio,
  }));

  const options = {
    showClickIndicators: params.options?.showClickIndicators ?? true,
    showDragPaths: params.options?.showDragPaths ?? true,
    showActionLabels: params.options?.showActionLabels ?? true,
    showProgressBar: params.options?.showProgressBar ?? true,
    showWatermark: params.options?.showWatermark ?? true,
    quality: params.options?.quality ?? 10,
  };

  // Generate GIF via offscreen document
  const gifResult = await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "GENERATE_GIF", frames: frameData, options },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.success) {
          resolve(response.result);
        } else {
          reject(new Error(response?.error || "Unknown error from offscreen"));
        }
      }
    );
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = params.filename || `recording-${timestamp}.gif`;

  let outputMessage;

  if (shouldDownload) {
    await chrome.downloads.download({
      url: gifResult.blobUrl,
      filename,
      saveAs: false,
    });
    outputMessage = `Successfully exported GIF with ${frames.length} frames. Downloaded "${filename}" (${Math.round(gifResult.size / 1024)}KB). Dimensions: ${gifResult.width}x${gifResult.height}. Recording cleared.`;
  } else {
    // Upload via drag/drop
    const navCheck = await checkNavigationInterception(tab.id, originalUrl, "GIF export upload action");
    if (navCheck) return navCheck;

    const uploadResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (base64, filename, x, y) => {
        const binary = atob(base64);
        const bytes = new Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const array = new Uint8Array(bytes);
        const blob = new Blob([array], { type: "image/gif" });
        const file = new File([blob], filename, {
          type: "image/gif",
          lastModified: Date.now(),
        });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        const target = document.elementFromPoint(x, y);
        if (!target) {
          throw new Error(`No element found at coordinates (${x}, ${y})`);
        }

        target.dispatchEvent(
          new DragEvent("dragenter", {
            bubbles: true,
            cancelable: true,
            dataTransfer,
            clientX: x,
            clientY: y,
          })
        );
        target.dispatchEvent(
          new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            dataTransfer,
            clientX: x,
            clientY: y,
          })
        );
        target.dispatchEvent(
          new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            dataTransfer,
            clientX: x,
            clientY: y,
          })
        );

        return {
          output: `Successfully dropped ${filename} (${Math.round(blob.size / 1024)}KB) at (${x}, ${y})`,
        };
      },
      args: [gifResult.base64, filename, params.coordinate[0], params.coordinate[1]],
    });

    if (!uploadResult || !uploadResult[0]?.result) {
      throw new Error("Failed to upload GIF to page");
    }

    outputMessage = `Successfully exported GIF with ${frames.length} frames. ${uploadResult[0].result.output}. Dimensions: ${gifResult.width}x${gifResult.height}. Recording cleared.`;
  }

  gifFrameStorage.clearFrames(groupId);

  const tabsMetadata = await K.getValidTabsWithMetadata(context.tabId);
  return {
    output: outputMessage,
    tabContext: {
      currentTabId: context.tabId,
      executedOnTabId: tab.id,
      availableTabs: tabsMetadata,
      tabCount: tabsMetadata.length,
    },
  };
}

// Handle clear action
async function handleClear(groupId) {
  const frameCount = gifFrameStorage.getFrameCount(groupId);

  if (frameCount === 0) {
    return { output: "No frames to clear for this tab group." };
  }

  gifFrameStorage.clearFrames(groupId);
  return {
    output: `Cleared ${frameCount} frame${frameCount === 1 ? "" : "s"} for this tab group. Recording stopped.`,
  };
}

// gif_creator tool (Ce)
export const gifCreatorTool = {
  name: "gif_creator",
  description:
    "Manage GIF recording and export for browser automation sessions. Control when to start/stop recording browser actions (clicks, scrolls, navigation), then export as an animated GIF with visual overlays (click indicators, action labels, progress bar, watermark). All operations are scoped to the tab's group. When starting recording, take a screenshot immediately after to capture the initial state as the first frame. When stopping recording, take a screenshot immediately before to capture the final state as the last frame. For export, either provide 'coordinate' to drag/drop upload to a page element, or set 'download: true' to download the GIF.",
  parameters: {
    action: {
      type: "string",
      description:
        "Action to perform: 'start_recording' (begin capturing), 'stop_recording' (stop capturing but keep frames), 'export' (generate and export GIF), 'clear' (discard frames)",
    },
    tabId: {
      type: "number",
      description: "Tab ID to identify which tab group this operation applies to",
    },
    coordinate: {
      type: "array",
      description:
        "Viewport coordinates [x, y] for drag & drop upload. Required for 'export' action unless 'download' is true.",
    },
    download: {
      type: "boolean",
      description:
        "If true, download the GIF instead of drag/drop upload. For 'export' action only.",
    },
    filename: {
      type: "string",
      description:
        "Optional filename for exported GIF (default: 'recording-[timestamp].gif'). For 'export' action only.",
    },
    options: {
      type: "object",
      description:
        "Optional GIF enhancement options for 'export' action. All default to true.",
    },
  },
  execute: async (params, context) => {
    try {
      const args = params;

      if (!args?.action) throw new Error("action parameter is required");
      if (!context?.tabId) throw new Error("No active tab found in context");

      const tab = await chrome.tabs.get(args.tabId);
      if (!tab) throw new Error(`Tab ${args.tabId} not found`);

      const groupId = tab.groupId ?? -1;

      // Verify tab is in MCP group for MCP sessions
      if (context.sessionId === "mcp-native-session") {
        const storageData = await chrome.storage.local.get(StorageKeys.MCP_TAB_GROUP_ID);
        if (groupId !== storageData[StorageKeys.MCP_TAB_GROUP_ID]) {
          return {
            error: `Tab ${args.tabId} is not in the MCP tab group. GIF recording only works for tabs within the MCP tab group.`,
          };
        }
      }

      switch (args.action) {
        case "start_recording":
          return await handleStartRecording(groupId);

        case "stop_recording":
          return await handleStopRecording(groupId);

        case "export":
          return await handleExport(args, tab, groupId, context);

        case "clear":
          return await handleClear(groupId);

        default:
          throw new Error(
            `Unknown action: ${args.action}. Must be one of: start_recording, stop_recording, export, clear`
          );
      }
    } catch (err) {
      return {
        error: `Failed to execute gif_creator: ${err instanceof Error ? err.message : "Unknown error"}`,
      };
    }
  },
  toAnthropicSchema: async () => ({
    name: "gif_creator",
    description:
      "Manage GIF recording and export for browser automation sessions. Control when to start/stop recording browser actions (clicks, scrolls, navigation), then export as an animated GIF with visual overlays (click indicators, action labels, progress bar, watermark). All operations are scoped to the tab's group. When starting recording, take a screenshot immediately after to capture the initial state as the first frame. When stopping recording, take a screenshot immediately before to capture the final state as the last frame. For export, either provide 'coordinate' to drag/drop upload to a page element, or set 'download: true' to download the GIF.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["start_recording", "stop_recording", "export", "clear"],
          description:
            "Action to perform: 'start_recording' (begin capturing), 'stop_recording' (stop capturing but keep frames), 'export' (generate and export GIF), 'clear' (discard frames)",
        },
        tabId: {
          type: "number",
          description: "Tab ID to identify which tab group this operation applies to",
        },
        coordinate: {
          type: "array",
          items: { type: "number" },
          description:
            "Viewport coordinates [x, y] for drag & drop upload. Required for 'export' action unless 'download' is true.",
        },
        download: {
          type: "boolean",
          description:
            "If true, download the GIF instead of drag/drop upload. For 'export' action only.",
        },
        filename: {
          type: "string",
          description:
            "Optional filename for exported GIF (default: 'recording-[timestamp].gif'). For 'export' action only.",
        },
        options: {
          type: "object",
          description:
            "Optional GIF enhancement options for 'export' action. Properties: showClickIndicators (bool), showDragPaths (bool), showActionLabels (bool), showProgressBar (bool), showWatermark (bool), quality (number 1-30). All default to true except quality (default: 10).",
          properties: {
            showClickIndicators: {
              type: "boolean",
              description: "Show orange circles at click locations (default: true)",
            },
            showDragPaths: {
              type: "boolean",
              description: "Show red arrows for drag actions (default: true)",
            },
            showActionLabels: {
              type: "boolean",
              description: "Show black labels describing actions (default: true)",
            },
            showProgressBar: {
              type: "boolean",
              description: "Show orange progress bar at bottom (default: true)",
            },
            showWatermark: {
              type: "boolean",
              description: "Show Logo watermark (default: true)",
            },
            quality: {
              type: "number",
              description:
                "GIF compression quality, 1-30 (lower = better quality, slower encoding). Default: 10",
            },
          },
        },
      },
      required: ["action", "tabId"],
    },
  }),
};

// Aliases for backward compatibility
export { gifFrameStorage as xe };
export { gifCreatorTool as Ce };
export { getActionDelay as Se };
