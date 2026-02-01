# Privacy Policy for Computer Control Extension

**Last Updated:** February 1, 2026

## Overview

Computer Control is a browser automation extension that enables AI agents to interact with web pages through the Model Context Protocol (MCP). This privacy policy explains how the extension handles user data.

## Data Collection

### What We Collect

The extension collects the following data **locally on your device** to perform automation tasks:

- **User Activity:** Mouse clicks, keyboard input, and scroll actions are captured to execute automation commands requested by the user through MCP clients.
- **Website Content:** Page text, images, and DOM structure are read to provide context to AI agents and generate accessibility trees.
- **Screenshots:** Visual captures of web pages are taken when requested by automation tasks.

### What We Do NOT Collect

- We do **not** collect personally identifiable information
- We do **not** collect health, financial, or authentication information
- We do **not** track browsing history for analytics
- We do **not** send any data to remote servers (except to the local MCP server on your machine)

## Data Storage

All data is:
- Processed locally on your device
- Stored temporarily in browser memory during automation sessions
- Never transmitted to external servers or third parties

The extension communicates only with:
1. A local native messaging host on your computer
2. The local MCP server running on localhost

## Data Sharing

We do **not** sell, transfer, or share user data with any third parties.

## Permissions

The extension requires various browser permissions to function. Each permission is used solely for browser automation purposes:

| Permission | Purpose |
|------------|---------|
| activeTab, tabs | Access tabs for automation |
| scripting | Inject automation scripts |
| debugger | Precise input control via DevTools Protocol |
| storage | Store session preferences |
| nativeMessaging | Communicate with local MCP server |
| downloads | Save screenshots and recordings |
| cookies | Handle session automation |
| clipboard | Copy/paste operations |

## User Control

You have full control over the extension:
- Disable or uninstall at any time
- The extension only activates when connected to an MCP client
- No background data collection when not in use

## Changes to This Policy

We may update this privacy policy from time to time. Changes will be posted to this repository.

## Contact

For questions about this privacy policy, please open an issue at:
https://github.com/mergd/computer-use/issues

## Open Source

This extension is open source. You can review the complete source code at:
https://github.com/mergd/computer-use
