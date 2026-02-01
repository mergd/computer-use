/**
 * types.ts - Shared TypeScript type definitions for MCP tools modules
 *
 * This file contains all shared type definitions used across the extension's
 * tool modules including tool parameters, results, permissions, and contexts.
 */
/**
 * Type guard to check if result is a permission request
 */
export function isPermissionRequired(result) {
    return "type" in result && result.type === "permission_required";
}
/**
 * Type guard to check if result is an error
 */
export function isToolError(result) {
    return "error" in result && result.error !== undefined;
}
