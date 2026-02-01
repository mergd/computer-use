/**
 * plan-tools.ts - Planning mode tools
 *
 * Contains tools and helpers for plan approval workflow:
 * - be: check if planning mode needed
 * - we: get planning mode reminder
 * - ye: filter and approve domains
 * - ve: plan schema
 * - Ie: update_plan tool
 */
import { ToolPermissionType } from "./storage.js";
import { DomainCategoryCache } from "./domain-cache.js";
// =============================================================================
// Plan Mode Helpers
// =============================================================================
/**
 * Check if planning mode is needed (be)
 * @param mode - Current extension mode
 * @param hasPlan - Whether a plan already exists
 * @returns True if planning mode should be entered
 */
export function shouldEnterPlanMode(mode, hasPlan) {
    return mode === "follow_a_plan" && !hasPlan;
}
/**
 * Get planning mode system reminder (we)
 * @returns System reminder string for planning mode
 */
export function getPlanModeReminder() {
    return "<system-reminder>You are in planning mode. Before executing any tools, you must first present a plan to the user using the update_plan tool. The plan should include: domains (list of domains you will visit) and approach (high-level steps you will take).</system-reminder>";
}
// =============================================================================
// Domain Filtering
// =============================================================================
/**
 * Helper to filter domains by category
 * @param domains - List of domains to filter
 * @returns Object with approved and filtered domain lists
 */
async function filterDomainsByCategory(domains) {
    const approved = [];
    const filtered = [];
    for (const domain of domains) {
        try {
            const url = domain.startsWith("http") ? domain : `https://${domain}`;
            const category = await DomainCategoryCache.getCategory(url);
            if (!category || (category !== "category1" && category !== "category2" && category !== "category_org_blocked")) {
                approved.push(domain);
            }
            else {
                filtered.push(domain);
            }
        }
        catch {
            // If category check fails, allow the domain
            approved.push(domain);
        }
    }
    return { approved, filtered };
}
/**
 * Filter and approve domains for planning (ye)
 * @param domains - List of domains to filter and approve
 * @param contextManager - Context manager to set approved domains
 * @returns List of approved domains
 */
export async function filterAndApproveDomains(domains, contextManager) {
    if (!domains || domains.length === 0)
        return [];
    const { approved, filtered } = await filterDomainsByCategory(domains);
    // Log filtered count if any
    if (filtered.length > 0) {
        // Domains were filtered due to category restrictions
    }
    contextManager.setTurnApprovedDomains(approved);
    return approved;
}
/**
 * Get domain categories for plan display
 * @param domains - List of domains to get categories for
 * @returns Array of domain/category pairs
 */
async function getDomainCategories(domains) {
    const results = [];
    for (const domain of domains) {
        try {
            const url = domain.startsWith("http") ? domain : `https://${domain}`;
            const category = await DomainCategoryCache.getCategory(url);
            results.push({ domain, category: category ?? undefined });
        }
        catch {
            results.push({ domain });
        }
    }
    return results;
}
// =============================================================================
// Plan Schema
// =============================================================================
/** Plan schema (ve) */
export const planSchema = {
    type: "object",
    properties: {
        domains: {
            type: "array",
            items: { type: "string" },
            description: "List of domains you will visit (e.g., ['github.com', 'stackoverflow.com']). These domains will be approved for the session when the user accepts the plan.",
        },
        approach: {
            type: "array",
            items: { type: "string" },
            description: "High-level description of what you will do. Focus on outcomes and key actions, not implementation details. Be concise - aim for 3-7 items.",
        },
    },
    required: ["domains", "approach"],
};
// =============================================================================
// Plan Validation
// =============================================================================
/**
 * Validate plan format
 * @param params - Parameters to validate
 * @returns Validation result with error, or null if valid
 */
function validatePlan(params) {
    const plan = params;
    const errors = {};
    if (!plan.domains || !Array.isArray(plan.domains)) {
        errors.domains = "Required field missing or not an array";
    }
    if (!plan.approach || !Array.isArray(plan.approach)) {
        errors.approach = "Required field missing or not an array";
    }
    if (Object.keys(errors).length > 0) {
        return {
            error: {
                type: "validation_error",
                message: "Invalid plan format. Both 'domains' and 'approach' are required arrays.",
                fields: errors,
            },
        };
    }
    return null;
}
/** update_plan tool (Ie) */
export const updatePlanTool = {
    name: "update_plan",
    description: "Present a plan to the user for approval before taking actions. The user will see the domains you intend to visit and your approach. Once approved, you can proceed with actions on the approved domains without additional permission prompts.",
    parameters: planSchema,
    async execute(params, context) {
        const validationError = validatePlan(params);
        if (validationError) {
            return { error: JSON.stringify(validationError.error) };
        }
        const { domains, approach } = params;
        const domainCategories = await getDomainCategories(domains);
        const result = {
            type: "permission_required",
            tool: ToolPermissionType.PLAN_APPROVAL,
            url: "",
            toolUseId: context?.toolUseId,
            actionData: { plan: { domains: domainCategories, approach } },
        };
        return result;
    },
    setPromptsConfig(config) {
        if (config.toolDescription) {
            this.description = config.toolDescription;
        }
        if (config.inputPropertyDescriptions) {
            const props = planSchema.properties;
            if (config.inputPropertyDescriptions.domains && props.domains) {
                props.domains.description = config.inputPropertyDescriptions.domains;
            }
            if (config.inputPropertyDescriptions.approach && props.approach) {
                props.approach.description = config.inputPropertyDescriptions.approach;
            }
        }
    },
    toAnthropicSchema() {
        return {
            type: "custom",
            name: this.name,
            description: this.description,
            input_schema: planSchema,
        };
    },
};
