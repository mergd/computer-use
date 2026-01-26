#!/usr/bin/env node
/**
 * Entry point launched by Chrome native messaging.
 * Reads/writes length-prefixed JSON on stdio.
 */

import { BrowserHost } from "./host.js";

const skipPermissions = process.argv.includes("--skip-permissions")
  || process.env.BROWSER_MCP_SKIP_PERMISSIONS === "1";

const host = new BrowserHost(process.stdin, process.stdout, undefined, { skipPermissions });
host.start();
