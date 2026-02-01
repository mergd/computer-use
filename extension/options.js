function updateStatus() {
  chrome.runtime.sendMessage({ type: 'check_native_host_status' }, (response) => {
    const nativeDot = document.getElementById('native-dot');
    const nativeStatus = document.getElementById('native-status');
    const mcpDot = document.getElementById('mcp-dot');
    const mcpStatus = document.getElementById('mcp-status');

    if (response?.status) {
      const { nativeHostInstalled, mcpConnected } = response.status;
      nativeDot.className = 'status-dot ' + (nativeHostInstalled ? 'connected' : 'disconnected');
      nativeStatus.textContent = nativeHostInstalled ? 'Connected' : 'Not Found';
      mcpDot.className = 'status-dot ' + (mcpConnected ? 'connected' : 'disconnected');
      mcpStatus.textContent = mcpConnected ? 'Connected' : 'Waiting...';
    } else {
      nativeDot.className = 'status-dot disconnected';
      nativeStatus.textContent = 'Unknown';
      mcpDot.className = 'status-dot disconnected';
      mcpStatus.textContent = 'Unknown';
    }
  });
}

document.getElementById('version').textContent = 'v' + chrome.runtime.getManifest().version;
updateStatus();
setInterval(updateStatus, 5000);
