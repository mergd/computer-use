/**
 * domain-cache.ts - Domain category caching for safety checks
 *
 * DomainCategoryCache (W) - Caches domain category lookups from API
 * Used to check if domains are blocked or restricted
 */
import { x as getApiToken } from "./storage.js";
import { normalizeDomain, extractHostname } from "./utils.js";
export class DomainCategoryCache {
    static cache = new Map();
    static CACHE_TTL_MS = 3e5; // 5 minutes
    static pendingRequests = new Map();
    static async getCategory(url) {
        if (self.__skipPermissions)
            return null;
        const domain = normalizeDomain(extractHostname(url));
        const cached = this.cache.get(domain);
        if (cached) {
            if (!(Date.now() - cached.timestamp > this.CACHE_TTL_MS)) {
                return cached.category;
            }
            this.cache.delete(domain);
        }
        const pending = this.pendingRequests.get(domain);
        if (pending)
            return pending;
        const request = this.fetchCategoryFromAPI(domain);
        this.pendingRequests.set(domain, request);
        try {
            return await request;
        }
        finally {
            this.pendingRequests.delete(domain);
        }
    }
    static async fetchCategoryFromAPI(domain) {
        const token = await getApiToken();
        if (!token)
            return;
        try {
            const apiUrl = new URL("/api/web/domain_info/browser_extension", "https://api.anthropic.com");
            apiUrl.searchParams.append("domain", domain);
            const response = await fetch(apiUrl.toString(), {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });
            if (!response.ok)
                return;
            const data = await response.json();
            const category = this.getEffectiveCategory(data);
            this.cache.set(domain, { category, timestamp: Date.now() });
            return category;
        }
        catch (error) {
            return;
        }
    }
    static getEffectiveCategory(data) {
        return data.org_policy === "block" ? "category_org_blocked" : data.category;
    }
    static clearCache() {
        this.cache.clear();
    }
    static evictFromCache(url) {
        const domain = normalizeDomain(url);
        this.cache.delete(domain);
    }
    static getCacheSize() {
        return this.cache.size;
    }
}
// Alias for backward compatibility
export { DomainCategoryCache as W };
