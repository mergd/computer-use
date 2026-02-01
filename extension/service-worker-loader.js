// Clear uninstall URL - we don't want to open external forms
chrome.runtime.setUninstallURL('');

import './assets/service-worker.js';

// Override after import and on install to ensure it stays cleared
chrome.runtime.setUninstallURL('');
chrome.runtime.onInstalled.addListener(() => {
  chrome.runtime.setUninstallURL('');
});
