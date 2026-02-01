/**
 * Offscreen document for operations that require DOM access.
 * Handles: clipboard read/write, audio playback, GIF export
 */

/**
 * Draw action overlay on canvas (click indicators, drag paths, labels)
 */
function drawActionOverlay(ctx, action, options, width, height) {
  if (!action) return;

  const scale = 1; // Already scaled in capture
  const x = action.coordinate?.[0] * scale;
  const y = action.coordinate?.[1] * scale;
  const startX = action.start_coordinate?.[0] * scale;
  const startY = action.start_coordinate?.[1] * scale;

  // Draw click indicator
  if (options.showClickIndicators && x !== undefined && y !== undefined) {
    if (["left_click", "right_click", "double_click", "triple_click"].includes(action.type)) {
      ctx.beginPath();
      ctx.arc(x, y, 20, 0, 2 * Math.PI);
      ctx.strokeStyle = "#FF6B00";
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, 2 * Math.PI);
      ctx.fillStyle = "#FF6B00";
      ctx.fill();
    }
  }

  // Draw drag path
  if (options.showDragPaths && action.type === "left_click_drag" && startX !== undefined && startY !== undefined) {
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#FF0000";
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw arrow head
    const angle = Math.atan2(y - startY, x - startX);
    const headLen = 15;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - headLen * Math.cos(angle - Math.PI / 6), y - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(x, y);
    ctx.lineTo(x - headLen * Math.cos(angle + Math.PI / 6), y - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  }

  // Draw action label
  if (options.showActionLabels) {
    let label = action.type?.replace(/_/g, " ");
    if (action.text && ["type", "key"].includes(action.type)) {
      label += `: ${action.text.substring(0, 30)}${action.text.length > 30 ? "..." : ""}`;
    }
    if (label) {
      ctx.font = "bold 16px Arial";
      const metrics = ctx.measureText(label);
      const padding = 8;
      const labelX = 10;
      const labelY = height - 40;

      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(labelX, labelY - 20, metrics.width + padding * 2, 28);
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(label, labelX + padding, labelY);
    }
  }
}

/**
 * Draw progress bar on canvas
 */
function drawProgressBar(ctx, frameIndex, totalFrames, width, height) {
  const barHeight = 4;
  const progress = (frameIndex + 1) / totalFrames;

  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  ctx.fillRect(0, height - barHeight, width, barHeight);
  ctx.fillStyle = "#FF6B00";
  ctx.fillRect(0, height - barHeight, width * progress, barHeight);
}

/**
 * Draw watermark on canvas
 */
function drawWatermark(ctx, width, height) {
  ctx.font = "12px Arial";
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.textAlign = "right";
  ctx.fillText("Computer Control", width - 10, height - 10);
  ctx.textAlign = "left";
}

/**
 * Generate GIF from frames
 */
async function generateGif(frames, options) {
  return new Promise((resolve, reject) => {
    if (!frames || frames.length === 0) {
      reject(new Error("No frames provided"));
      return;
    }

    // Get dimensions from first frame
    const firstFrame = frames[0];
    const width = firstFrame.viewportWidth || 800;
    const height = firstFrame.viewportHeight || 600;

    // Create GIF encoder
    const gif = new GIF({
      workers: 2,
      quality: options.quality || 10,
      width: width,
      height: height,
      workerScript: "gif.worker.js",
    });

    // Create canvas for drawing
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    let processedFrames = 0;

    // Process each frame
    frames.forEach((frame, index) => {
      const img = new Image();
      img.onload = () => {
        // Clear canvas
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, width, height);

        // Draw the screenshot
        ctx.drawImage(img, 0, 0, width, height);

        // Draw overlays
        if (frame.action) {
          drawActionOverlay(ctx, frame.action, options, width, height);
        }
        if (options.showProgressBar) {
          drawProgressBar(ctx, index, frames.length, width, height);
        }
        if (options.showWatermark) {
          drawWatermark(ctx, width, height);
        }

        // Add frame to GIF
        gif.addFrame(ctx, { copy: true, delay: frame.delay || 500 });

        processedFrames++;
        if (processedFrames === frames.length) {
          gif.render();
        }
      };

      img.onerror = () => {
        processedFrames++;
        if (processedFrames === frames.length) {
          gif.render();
        }
      };

      // Load image from base64
      img.src = `data:image/${frame.format || "png"};base64,${frame.base64}`;
    });

    gif.on("finished", (blob) => {
      const blobUrl = URL.createObjectURL(blob);

      // Read blob as base64 for transfer
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(",")[1];
        resolve({
          blobUrl,
          base64,
          size: blob.size,
          width,
          height,
        });
      };
      reader.onerror = () => reject(new Error("Failed to read GIF blob"));
      reader.readAsDataURL(blob);
    });

    gif.on("error", (err) => {
      reject(err);
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case "CLIPBOARD_READ": {
        try {
          const text = await navigator.clipboard.readText();
          sendResponse({ success: true, text });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
        break;
      }

      case "CLIPBOARD_WRITE": {
        try {
          await navigator.clipboard.writeText(message.text || "");
          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
        break;
      }

      case "PLAY_NOTIFICATION_SOUND": {
        try {
          const audio = new Audio(message.audioUrl);
          audio.volume = message.volume || 0.5;
          await audio.play();
          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
        break;
      }

      case "GENERATE_GIF": {
        try {
          const result = await generateGif(message.frames, message.options || {});
          sendResponse({ success: true, result });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
        break;
      }

      default:
        sendResponse({ success: false, error: `Unknown message type: ${message.type}` });
    }
  })();

  // Return true to indicate async response
  return true;
});
