/**
 * tab-group-manager.ts - Chrome Tab Group Management
 *
 * CLASSES:
 *   TabSubscriptionManager - Manages tab event subscriptions
 *   TabGroupManager        - Manages Chrome tab groups for MCP sessions
 *
 * SINGLETONS:
 *   getTabSubscriptionManagerInstance = () => TabSubscriptionManager.getInstance()
 *   tabGroupManagerInstance = TabGroupManager.getInstance()
 *
 * EXPORTS (with backward-compatible aliases):
 *   tabGroupManagerInstance (alias: K)
 *   TabGroupManager (alias: H)
 *   COMPUTER_CONTROL (alias: j) - "Computer Control" constant
 *   MCP (alias: z) - "MCP" constant
 *   getTabSubscriptionManagerInstance (alias: D)
 *   TabSubscriptionManager (alias: M)
 */
import { StorageKeys } from "./storage.js";
// DomainCategoryCache is imported from mcp-tools.js
let W = null;
export function setDomainCategoryCache(cache) {
    W = cache;
}
// ============================================================================
// TabSubscriptionManager - Manages tab event subscriptions
// ============================================================================
class TabSubscriptionManager {
    static instance = null;
    subscriptions = new Map();
    chromeUpdateListener = null;
    chromeActivatedListener = null;
    chromeRemovedListener = null;
    relevantTabIds = new Set();
    nextSubscriptionId = 1;
    constructor() { }
    static getInstance() {
        if (!TabSubscriptionManager.instance) {
            TabSubscriptionManager.instance = new TabSubscriptionManager();
        }
        return TabSubscriptionManager.instance;
    }
    subscribe(tabId, eventTypes, callback) {
        const subscriptionId = "sub_" + this.nextSubscriptionId++;
        this.subscriptions.set(subscriptionId, { tabId, eventTypes, callback });
        if (tabId !== "all") {
            this.relevantTabIds.add(tabId);
        }
        if (this.subscriptions.size === 1) {
            this.startListeners();
        }
        return subscriptionId;
    }
    unsubscribe(subscriptionId) {
        const subscription = this.subscriptions.get(subscriptionId);
        if (subscription) {
            this.subscriptions.delete(subscriptionId);
            if (subscription.tabId !== "all") {
                let hasOtherSubscription = false;
                for (const [, sub] of this.subscriptions) {
                    if (sub.tabId === subscription.tabId) {
                        hasOtherSubscription = true;
                        break;
                    }
                }
                if (!hasOtherSubscription) {
                    this.relevantTabIds.delete(subscription.tabId);
                }
            }
            if (this.subscriptions.size === 0) {
                this.stopListeners();
            }
        }
    }
    startListeners() {
        this.chromeUpdateListener = (tabId, changeInfo, tab) => {
            if (this.relevantTabIds.size > 0 && !this.relevantTabIds.has(tabId)) {
                let hasAllSubscription = false;
                for (const [, sub] of this.subscriptions) {
                    if (sub.tabId === "all") {
                        hasAllSubscription = true;
                        break;
                    }
                }
                if (!hasAllSubscription)
                    return;
            }
            const changes = {};
            let hasChanges = false;
            if (changeInfo.url !== undefined) {
                changes.url = changeInfo.url;
                hasChanges = true;
            }
            if (changeInfo.status !== undefined) {
                changes.status = changeInfo.status;
                hasChanges = true;
            }
            if ("groupId" in changeInfo) {
                changes.groupId = changeInfo.groupId;
                hasChanges = true;
            }
            if (changeInfo.title !== undefined) {
                changes.title = changeInfo.title;
                hasChanges = true;
            }
            if (hasChanges) {
                for (const [, sub] of this.subscriptions) {
                    if (sub.tabId !== "all" && sub.tabId !== tabId)
                        continue;
                    let shouldNotify = false;
                    for (const eventType of sub.eventTypes) {
                        if (changes[eventType] !== undefined) {
                            shouldNotify = true;
                            break;
                        }
                    }
                    if (shouldNotify) {
                        try {
                            sub.callback(tabId, changes, tab);
                        }
                        catch {
                            // Ignore callback errors
                        }
                    }
                }
            }
        };
        this.chromeActivatedListener = (activeInfo) => {
            const tabId = activeInfo.tabId;
            if (this.relevantTabIds.size > 0 && !this.relevantTabIds.has(tabId)) {
                let hasAllSubscription = false;
                for (const [, sub] of this.subscriptions) {
                    if (sub.tabId === "all") {
                        hasAllSubscription = true;
                        break;
                    }
                }
                if (!hasAllSubscription)
                    return;
            }
            const changes = { active: true };
            for (const [, sub] of this.subscriptions) {
                if ((sub.tabId === "all" || sub.tabId === tabId) &&
                    sub.eventTypes.includes("active")) {
                    try {
                        sub.callback(tabId, changes);
                    }
                    catch {
                        // Ignore callback errors
                    }
                }
            }
        };
        chrome.tabs.onUpdated.addListener(this.chromeUpdateListener);
        chrome.tabs.onActivated.addListener(this.chromeActivatedListener);
        this.chromeRemovedListener = (tabId) => {
            if (this.relevantTabIds.size > 0 && !this.relevantTabIds.has(tabId)) {
                let hasAllSubscription = false;
                for (const [, sub] of this.subscriptions) {
                    if (sub.tabId === "all") {
                        hasAllSubscription = true;
                        break;
                    }
                }
                if (!hasAllSubscription)
                    return;
            }
            const changes = { removed: true };
            for (const [, sub] of this.subscriptions) {
                if ((sub.tabId === "all" || sub.tabId === tabId) &&
                    sub.eventTypes.includes("removed")) {
                    try {
                        sub.callback(tabId, changes);
                    }
                    catch {
                        // Ignore callback errors
                    }
                }
            }
        };
        chrome.tabs.onRemoved.addListener(this.chromeRemovedListener);
    }
    stopListeners() {
        if (this.chromeUpdateListener) {
            chrome.tabs.onUpdated.removeListener(this.chromeUpdateListener);
            this.chromeUpdateListener = null;
        }
        if (this.chromeActivatedListener) {
            chrome.tabs.onActivated.removeListener(this.chromeActivatedListener);
            this.chromeActivatedListener = null;
        }
        if (this.chromeRemovedListener) {
            chrome.tabs.onRemoved.removeListener(this.chromeRemovedListener);
            this.chromeRemovedListener = null;
        }
        this.relevantTabIds.clear();
    }
    getSubscriptionCount() {
        return this.subscriptions.size;
    }
    hasActiveListeners() {
        return (this.chromeUpdateListener !== null ||
            this.chromeActivatedListener !== null ||
            this.chromeRemovedListener !== null);
    }
}
const getTabSubscriptionManagerInstance = () => TabSubscriptionManager.getInstance();
const COMPUTER_CONTROL = "Computer Control";
const MCP = "MCP";
// ============================================================================
// TabGroupManager - Manages Chrome tab groups for MCP sessions
// Singleton accessed via tabGroupManagerInstance = TabGroupManager.getInstance()
// ============================================================================
class TabGroupManager {
    static instance;
    groupMetadata = new Map();
    initialized = false;
    STORAGE_KEY = StorageKeys.TAB_GROUPS;
    groupBlocklistStatuses = new Map();
    blocklistListeners = new Set();
    indicatorUpdateTimer = null;
    INDICATOR_UPDATE_DELAY = 100;
    pendingRegroups = new Map();
    processingMainTabRemoval = new Set();
    mcpTabGroupId = null;
    MCP_TAB_GROUP_KEY = StorageKeys.MCP_TAB_GROUP_ID;
    tabGroupListenerSubscriptionId = null;
    isTabGroupListenerStarted = false;
    DISMISSED_GROUPS_KEY = StorageKeys.DISMISSED_TAB_GROUPS;
    constructor() {
        this.startTabRemovalListener();
    }
    startTabRemovalListener() {
        chrome.tabs.onRemoved.addListener(async (tabId) => {
            for (const [groupId, status] of this.groupBlocklistStatuses.entries()) {
                if (status.categoriesByTab.has(tabId)) {
                    await this.removeTabFromBlocklistTracking(groupId, tabId);
                }
            }
        });
    }
    static getInstance() {
        if (!TabGroupManager.instance) {
            TabGroupManager.instance = new TabGroupManager();
        }
        return TabGroupManager.instance;
    }
    async dismissStaticIndicatorsForGroup(chromeGroupId) {
        const storage = await chrome.storage.local.get(this.DISMISSED_GROUPS_KEY);
        const dismissedGroups = storage[this.DISMISSED_GROUPS_KEY] || [];
        if (!dismissedGroups.includes(chromeGroupId)) {
            dismissedGroups.push(chromeGroupId);
        }
        await chrome.storage.local.set({
            [this.DISMISSED_GROUPS_KEY]: dismissedGroups,
        });
        try {
            const tabs = await chrome.tabs.query({ groupId: chromeGroupId });
            for (const tab of tabs) {
                if (tab.id) {
                    try {
                        await chrome.tabs.sendMessage(tab.id, {
                            type: "HIDE_STATIC_INDICATOR",
                        });
                    }
                    catch {
                        // Ignore message errors
                    }
                }
            }
        }
        catch {
            // Ignore query errors
        }
    }
    async isGroupDismissed(chromeGroupId) {
        try {
            const dismissedGroups = (await chrome.storage.local.get(this.DISMISSED_GROUPS_KEY))[this.DISMISSED_GROUPS_KEY];
            return Array.isArray(dismissedGroups) && dismissedGroups.includes(chromeGroupId);
        }
        catch {
            return false;
        }
    }
    async initialize(force = false) {
        if (this.initialized && !force)
            return;
        await this.loadFromStorage();
        await this.reconcileWithChrome();
        this.initialized = true;
    }
    startTabGroupChangeListener() {
        if (this.isTabGroupListenerStarted)
            return;
        const manager = getTabSubscriptionManagerInstance();
        this.tabGroupListenerSubscriptionId = manager.subscribe("all", ["groupId"], async (tabId, changeInfo) => {
            if ("groupId" in changeInfo) {
                await this.handleTabGroupChange(tabId, changeInfo.groupId);
            }
        });
        this.isTabGroupListenerStarted = true;
    }
    stopTabGroupChangeListener() {
        if (!this.isTabGroupListenerStarted || !this.tabGroupListenerSubscriptionId)
            return;
        getTabSubscriptionManagerInstance().unsubscribe(this.tabGroupListenerSubscriptionId);
        this.tabGroupListenerSubscriptionId = null;
        this.isTabGroupListenerStarted = false;
    }
    async handleTabGroupChange(tabId, newGroupId) {
        // Check if tab was removed from a managed group
        for (const [mainTabId, metadata] of this.groupMetadata.entries()) {
            if (metadata.memberStates.has(tabId)) {
                if (newGroupId === chrome.tabGroups.TAB_GROUP_ID_NONE ||
                    newGroupId !== metadata.chromeGroupId) {
                    const memberState = metadata.memberStates.get(tabId);
                    const indicatorState = memberState?.indicatorState || "none";
                    try {
                        let messageType = "HIDE_AGENT_INDICATORS";
                        if (indicatorState === "static") {
                            messageType = "HIDE_STATIC_INDICATOR";
                        }
                        await this.sendIndicatorMessage(tabId, messageType);
                    }
                    catch {
                        // Ignore message errors
                    }
                    metadata.memberStates.delete(tabId);
                    // Handle main tab being removed from group
                    if (tabId === mainTabId) {
                        if (this.processingMainTabRemoval.has(mainTabId))
                            return;
                        if (this.pendingRegroups.has(mainTabId))
                            return;
                        this.processingMainTabRemoval.add(mainTabId);
                        const currentIndicatorState = metadata.memberStates.get(mainTabId)?.indicatorState || "none";
                        const oldGroupId = metadata.chromeGroupId;
                        try {
                            const newChromeGroupId = await chrome.tabs.group({
                                tabIds: [mainTabId],
                            });
                            await chrome.tabGroups.update(newChromeGroupId, {
                                title: COMPUTER_CONTROL,
                                color: chrome.tabGroups.Color.ORANGE,
                                collapsed: false,
                            });
                            metadata.chromeGroupId = newChromeGroupId;
                            metadata.memberStates.clear();
                            metadata.memberStates.set(mainTabId, {
                                indicatorState: currentIndicatorState,
                            });
                            if (oldGroupId !== newChromeGroupId) {
                                this.groupBlocklistStatuses.delete(oldGroupId);
                            }
                            if (currentIndicatorState === "pulsing") {
                                try {
                                    await this.sendIndicatorMessage(mainTabId, "SHOW_AGENT_INDICATORS");
                                }
                                catch {
                                    // Ignore message errors
                                }
                            }
                            this.groupMetadata.set(mainTabId, metadata);
                            await this.saveToStorage();
                            await this.cleanupOldGroup(oldGroupId, mainTabId);
                            this.processingMainTabRemoval.delete(mainTabId);
                            return;
                        }
                        catch (error) {
                            if (error instanceof Error &&
                                error.message &&
                                error.message.includes("dragging")) {
                                this.pendingRegroups.set(mainTabId, {
                                    tabId: mainTabId,
                                    originalGroupId: oldGroupId,
                                    indicatorState: currentIndicatorState,
                                    metadata,
                                    attemptCount: 0,
                                });
                                this.scheduleRegroupRetry(mainTabId);
                                return;
                            }
                            this.groupMetadata.delete(mainTabId);
                            this.groupBlocklistStatuses.delete(oldGroupId);
                            await this.saveToStorage();
                            this.processingMainTabRemoval.delete(mainTabId);
                            return;
                        }
                    }
                    await this.saveToStorage();
                    break;
                }
            }
        }
        // Check if tab was added to a managed group
        if (newGroupId && newGroupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
            for (const [mainTabId, metadata] of this.groupMetadata.entries()) {
                if (metadata.chromeGroupId === newGroupId) {
                    if (!metadata.memberStates.has(tabId)) {
                        const isSecondary = tabId !== mainTabId;
                        metadata.memberStates.set(tabId, {
                            indicatorState: isSecondary ? "static" : "none",
                        });
                        try {
                            const tab = await chrome.tabs.get(tabId);
                            if (tab.url) {
                                await this.updateTabBlocklistStatus(tabId, tab.url);
                            }
                        }
                        catch {
                            // Ignore tab get errors
                        }
                        const isDismissed = await this.isGroupDismissed(metadata.chromeGroupId);
                        if (isSecondary && !isDismissed) {
                            let retryCount = 0;
                            const maxRetries = 3;
                            const retryDelay = 500;
                            const tryShowIndicator = async () => {
                                try {
                                    await this.sendIndicatorMessage(tabId, "SHOW_STATIC_INDICATOR");
                                    return true;
                                }
                                catch {
                                    retryCount++;
                                    if (retryCount < maxRetries) {
                                        setTimeout(tryShowIndicator, retryDelay);
                                    }
                                    return false;
                                }
                            };
                            await tryShowIndicator();
                        }
                        await this.saveToStorage();
                    }
                    break;
                }
            }
        }
    }
    async cleanupOldGroup(oldGroupId, excludeTabId) {
        try {
            const tabs = await chrome.tabs.query({ groupId: oldGroupId });
            for (const tab of tabs) {
                if (tab.id && tab.id !== excludeTabId) {
                    try {
                        await this.sendIndicatorMessage(tab.id, "HIDE_STATIC_INDICATOR");
                    }
                    catch {
                        // Ignore message errors
                    }
                }
            }
            const tabIds = tabs
                .filter((t) => t.id && t.id !== excludeTabId)
                .map((t) => t.id);
            if (tabIds.length > 0) {
                await chrome.tabs.ungroup(tabIds);
            }
        }
        catch {
            // Ignore cleanup errors
        }
    }
    scheduleRegroupRetry(tabId) {
        const pending = this.pendingRegroups.get(tabId);
        if (!pending)
            return;
        if (pending.timeoutId) {
            clearTimeout(pending.timeoutId);
        }
        pending.timeoutId = setTimeout(() => {
            this.attemptRegroup(tabId);
        }, 1000);
    }
    async attemptRegroup(tabId) {
        const pending = this.pendingRegroups.get(tabId);
        if (!pending)
            return;
        pending.attemptCount++;
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
                this.pendingRegroups.delete(tabId);
                return;
            }
            const newGroupId = await chrome.tabs.group({ tabIds: [tabId] });
            await chrome.tabGroups.update(newGroupId, {
                title: COMPUTER_CONTROL,
                color: chrome.tabGroups.Color.ORANGE,
                collapsed: false,
            });
            pending.metadata.chromeGroupId = newGroupId;
            pending.metadata.memberStates.clear();
            pending.metadata.memberStates.set(tabId, {
                indicatorState: pending.indicatorState,
            });
            if (pending.originalGroupId !== newGroupId) {
                this.groupBlocklistStatuses.delete(pending.originalGroupId);
            }
            if (pending.indicatorState === "pulsing") {
                try {
                    await this.sendIndicatorMessage(tabId, "SHOW_AGENT_INDICATORS");
                }
                catch {
                    // Ignore message errors
                }
            }
            this.groupMetadata.set(tabId, pending.metadata);
            await this.saveToStorage();
            await this.cleanupOldGroup(pending.originalGroupId, tabId);
            this.pendingRegroups.delete(tabId);
            this.processingMainTabRemoval.delete(tabId);
        }
        catch {
            if (pending.attemptCount < 5) {
                this.scheduleRegroupRetry(tabId);
            }
            else {
                // Final attempt
                try {
                    const newGroupId = await chrome.tabs.group({ tabIds: [tabId] });
                    await chrome.tabGroups.update(newGroupId, {
                        title: COMPUTER_CONTROL,
                        color: chrome.tabGroups.Color.ORANGE,
                        collapsed: false,
                    });
                    pending.metadata.chromeGroupId = newGroupId;
                    pending.metadata.memberStates.clear();
                    pending.metadata.memberStates.set(tabId, {
                        indicatorState: pending.indicatorState,
                    });
                    if (pending.originalGroupId !== newGroupId) {
                        this.groupBlocklistStatuses.delete(pending.originalGroupId);
                    }
                    if (pending.indicatorState === "pulsing") {
                        try {
                            await this.sendIndicatorMessage(tabId, "SHOW_AGENT_INDICATORS");
                        }
                        catch {
                            // Ignore message errors
                        }
                    }
                    this.groupMetadata.set(tabId, pending.metadata);
                    await this.saveToStorage();
                    await this.cleanupOldGroup(pending.originalGroupId, tabId);
                }
                catch {
                    this.groupMetadata.delete(tabId);
                    this.groupBlocklistStatuses.delete(pending.originalGroupId);
                    await this.saveToStorage();
                }
                this.pendingRegroups.delete(tabId);
                this.processingMainTabRemoval.delete(tabId);
            }
        }
    }
    async loadFromStorage() {
        try {
            const stored = (await chrome.storage.local.get(this.STORAGE_KEY))[this.STORAGE_KEY];
            if (stored && typeof stored === "object") {
                this.groupMetadata = new Map(Object.entries(stored).map(([key, value]) => {
                    const metadata = value;
                    if (metadata.memberStates &&
                        typeof metadata.memberStates === "object" &&
                        !(metadata.memberStates instanceof Map)) {
                        metadata.memberStates = new Map(Object.entries(metadata.memberStates).map(([k, v]) => [
                            parseInt(k),
                            v,
                        ]));
                    }
                    else if (!metadata.memberStates) {
                        metadata.memberStates = new Map();
                    }
                    return [parseInt(key), metadata];
                }));
            }
        }
        catch {
            // Ignore storage errors
        }
    }
    async saveToStorage() {
        try {
            const serialized = Object.fromEntries(Array.from(this.groupMetadata.entries()).map(([key, metadata]) => [
                key,
                {
                    ...metadata,
                    memberStates: Object.fromEntries(metadata.memberStates || new Map()),
                },
            ]));
            await chrome.storage.local.set({ [this.STORAGE_KEY]: serialized });
        }
        catch {
            // Ignore storage errors
        }
    }
    findMainTabInChromeGroup(chromeGroupId) {
        for (const [mainTabId, metadata] of this.groupMetadata.entries()) {
            if (metadata.chromeGroupId === chromeGroupId) {
                return mainTabId;
            }
        }
        return null;
    }
    async createGroup(tabId) {
        const existing = await this.findGroupByMainTab(tabId);
        if (existing)
            return existing;
        const tab = await chrome.tabs.get(tabId);
        let chromeGroupId;
        let domain = "blank";
        if (tab.url && tab.url !== "" && !tab.url.startsWith("chrome://")) {
            try {
                domain = new URL(tab.url).hostname || "blank";
            }
            catch {
                domain = "blank";
            }
        }
        // Ungroup if already in a different managed group
        if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
            if (!this.findMainTabInChromeGroup(tab.groupId)) {
                await chrome.tabs.ungroup([tabId]);
            }
        }
        // Retry group creation
        let retries = 3;
        while (retries > 0) {
            try {
                chromeGroupId = await chrome.tabs.group({ tabIds: [tabId] });
                break;
            }
            catch (error) {
                retries--;
                if (retries === 0)
                    throw error;
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }
        if (!chromeGroupId) {
            throw new Error("Failed to create Chrome tab group");
        }
        await chrome.tabGroups.update(chromeGroupId, {
            title: COMPUTER_CONTROL,
            color: chrome.tabGroups.Color.ORANGE,
            collapsed: false,
        });
        const metadata = {
            mainTabId: tabId,
            createdAt: Date.now(),
            domain,
            chromeGroupId,
            memberStates: new Map(),
        };
        metadata.memberStates.set(tabId, { indicatorState: "none" });
        this.groupMetadata.set(tabId, metadata);
        await this.saveToStorage();
        const memberTabs = await this.getGroupMembers(chromeGroupId);
        return { ...metadata, memberTabs };
    }
    async adoptOrphanedGroup(tabId, chromeGroupId) {
        const existing = await this.findGroupByMainTab(tabId);
        if (existing)
            return existing;
        const tab = await chrome.tabs.get(tabId);
        if (!tab.url)
            throw new Error("Tab has no URL");
        const domain = new URL(tab.url).hostname;
        if (tab.groupId !== chromeGroupId) {
            throw new Error(`Tab ${tabId} is not in Chrome group ${chromeGroupId}`);
        }
        const metadata = {
            mainTabId: tabId,
            createdAt: Date.now(),
            domain,
            chromeGroupId,
            memberStates: new Map(),
        };
        metadata.memberStates.set(tabId, { indicatorState: "none" });
        const groupTabs = await chrome.tabs.query({ groupId: chromeGroupId });
        for (const groupTab of groupTabs) {
            if (groupTab.id && groupTab.id !== tabId) {
                metadata.memberStates.set(groupTab.id, { indicatorState: "static" });
            }
        }
        this.groupMetadata.set(tabId, metadata);
        await this.saveToStorage();
        const memberTabs = await this.getGroupMembers(chromeGroupId);
        return { ...metadata, memberTabs };
    }
    async addTabToGroup(mainTabId, tabId) {
        const metadata = this.groupMetadata.get(mainTabId);
        if (!metadata)
            return;
        try {
            await chrome.tabs.group({
                tabIds: [tabId],
                groupId: metadata.chromeGroupId,
            });
            if (!metadata.memberStates.has(tabId)) {
                metadata.memberStates.set(tabId, {
                    indicatorState: tabId === mainTabId ? "none" : "static",
                });
            }
            try {
                const tab = await chrome.tabs.get(tabId);
                if (tab.url) {
                    await this.updateTabBlocklistStatus(tabId, tab.url);
                }
            }
            catch {
                // Ignore tab get errors
            }
            const isDismissed = await this.isGroupDismissed(metadata.chromeGroupId);
            if (tabId !== mainTabId && !isDismissed) {
                try {
                    await chrome.tabs.sendMessage(tabId, { type: "SHOW_STATIC_INDICATOR" });
                }
                catch {
                    // Ignore message errors
                }
            }
        }
        catch {
            // Ignore group errors
        }
        await this.saveToStorage();
    }
    async getGroupMembers(chromeGroupId) {
        const tabs = await chrome.tabs.query({ groupId: chromeGroupId });
        let metadata;
        for (const [, meta] of this.groupMetadata.entries()) {
            if (meta.chromeGroupId === chromeGroupId) {
                metadata = meta;
                break;
            }
        }
        return tabs
            .filter((tab) => tab.id !== undefined)
            .map((tab) => {
            const tabId = tab.id;
            const memberState = metadata?.memberStates.get(tabId);
            return {
                tabId,
                url: tab.url || "",
                title: tab.title || "",
                joinedAt: Date.now(),
                indicatorState: memberState?.indicatorState || "none",
            };
        });
    }
    async getGroupDetails(mainTabId) {
        const metadata = this.groupMetadata.get(mainTabId);
        if (!metadata) {
            throw new Error(`No group found for main tab ${mainTabId}`);
        }
        const memberTabs = await this.getGroupMembers(metadata.chromeGroupId);
        return { ...metadata, memberTabs };
    }
    async findOrphanedTabs() {
        const orphaned = [];
        const seen = new Set();
        const ungroupedTabs = await chrome.tabs.query({
            groupId: chrome.tabGroups.TAB_GROUP_ID_NONE,
        });
        const managedTabIds = new Set();
        for (const [mainTabId] of this.groupMetadata.entries()) {
            managedTabIds.add(mainTabId);
            const group = await this.findGroupByMainTab(mainTabId);
            if (group) {
                group.memberTabs.forEach((member) => managedTabIds.add(member.tabId));
            }
        }
        for (const tab of ungroupedTabs) {
            if (!tab.id || seen.has(tab.id) || managedTabIds.has(tab.id))
                continue;
            seen.add(tab.id);
            if (tab.openerTabId &&
                managedTabIds.has(tab.openerTabId) &&
                tab.url &&
                !tab.url.startsWith("chrome://") &&
                !tab.url.startsWith("chrome-extension://") &&
                tab.url !== "about:blank") {
                orphaned.push({
                    tabId: tab.id,
                    url: tab.url || "",
                    title: tab.title || "",
                    openerTabId: tab.openerTabId,
                    detectedAt: Date.now(),
                });
            }
        }
        return orphaned;
    }
    async reconcileWithChrome() {
        const allTabs = await chrome.tabs.query({});
        const activeGroupIds = new Set();
        for (const tab of allTabs) {
            if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
                activeGroupIds.add(tab.groupId);
            }
        }
        const toRemove = [];
        let needsSave = false;
        for (const [mainTabId, metadata] of this.groupMetadata.entries()) {
            try {
                const tab = await chrome.tabs.get(mainTabId);
                if (!activeGroupIds.has(metadata.chromeGroupId)) {
                    toRemove.push(mainTabId);
                }
                else if (tab.groupId !== metadata.chromeGroupId) {
                    toRemove.push(mainTabId);
                }
                else {
                    // Clean up stale member states
                    const groupTabs = await chrome.tabs.query({
                        groupId: metadata.chromeGroupId,
                    });
                    const currentTabIds = new Set(groupTabs.map((t) => t.id).filter((id) => id !== undefined));
                    const staleMembers = [];
                    for (const [memberId] of metadata.memberStates) {
                        if (!currentTabIds.has(memberId)) {
                            staleMembers.push(memberId);
                        }
                    }
                    if (staleMembers.length > 0) {
                        for (const memberId of staleMembers) {
                            metadata.memberStates.delete(memberId);
                            try {
                                await this.sendIndicatorMessage(memberId, "HIDE_AGENT_INDICATORS");
                            }
                            catch {
                                // Ignore message errors
                            }
                        }
                        needsSave = true;
                    }
                }
            }
            catch {
                toRemove.push(mainTabId);
            }
        }
        for (const mainTabId of toRemove) {
            this.groupMetadata.delete(mainTabId);
        }
        if (toRemove.length > 0 || needsSave) {
            await this.saveToStorage();
        }
    }
    async getAllGroups() {
        await this.initialize();
        const groups = [];
        for (const [, metadata] of this.groupMetadata.entries()) {
            try {
                const memberTabs = await this.getGroupMembers(metadata.chromeGroupId);
                groups.push({ ...metadata, memberTabs });
            }
            catch {
                // Ignore errors for individual groups
            }
        }
        return groups;
    }
    async findGroupByTab(tabId) {
        await this.initialize();
        // Check if this is a main tab
        const mainTabMetadata = this.groupMetadata.get(tabId);
        if (mainTabMetadata) {
            const memberTabs = await this.getGroupMembers(mainTabMetadata.chromeGroupId);
            return { ...mainTabMetadata, memberTabs };
        }
        // Check if tab is in a managed group
        const tab = await chrome.tabs.get(tabId);
        if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
            return null;
        }
        for (const [, metadata] of this.groupMetadata.entries()) {
            if (metadata.chromeGroupId === tab.groupId) {
                const memberTabs = await this.getGroupMembers(metadata.chromeGroupId);
                return { ...metadata, memberTabs };
            }
        }
        // Tab is in an unmanaged Chrome group
        const groupTabs = await chrome.tabs.query({ groupId: tab.groupId });
        if (groupTabs.length === 0)
            return null;
        groupTabs.sort((a, b) => a.index - b.index);
        const firstTab = groupTabs[0];
        if (!firstTab.id || !firstTab.url)
            return null;
        return {
            mainTabId: firstTab.id,
            createdAt: Date.now(),
            domain: new URL(firstTab.url).hostname,
            chromeGroupId: tab.groupId,
            memberStates: new Map(),
            memberTabs: groupTabs
                .filter((t) => t.id !== undefined)
                .map((t) => ({
                tabId: t.id,
                url: t.url || "",
                title: t.title || "",
                joinedAt: Date.now(),
            })),
            isUnmanaged: true,
        };
    }
    async findGroupByMainTab(mainTabId) {
        await this.initialize();
        const metadata = this.groupMetadata.get(mainTabId);
        if (!metadata)
            return null;
        try {
            const memberTabs = await this.getGroupMembers(metadata.chromeGroupId);
            return { ...metadata, memberTabs };
        }
        catch {
            return null;
        }
    }
    async isInGroup(tabId) {
        return (await this.findGroupByTab(tabId)) !== null;
    }
    isMainTab(tabId) {
        return this.groupMetadata.has(tabId);
    }
    async getMainTabId(tabId) {
        const group = await this.findGroupByTab(tabId);
        return group?.mainTabId || null;
    }
    async promoteToMainTab(currentMainTabId, newMainTabId) {
        const metadata = this.groupMetadata.get(currentMainTabId);
        if (!metadata) {
            throw new Error(`No group found for main tab ${currentMainTabId}`);
        }
        const newMainTab = await chrome.tabs.get(newMainTabId);
        if (newMainTab.groupId !== metadata.chromeGroupId) {
            throw new Error(`Tab ${newMainTabId} is not in the same group as ${currentMainTabId}`);
        }
        const oldMainState = metadata.memberStates.get(currentMainTabId) || {
            indicatorState: "none",
        };
        // Hide indicator on old main tab
        try {
            await chrome.tabs.get(currentMainTabId);
            if (oldMainState.indicatorState === "pulsing") {
                await this.sendIndicatorMessage(currentMainTabId, "HIDE_AGENT_INDICATORS");
            }
        }
        catch {
            // Tab may not exist
        }
        metadata.memberStates.get(newMainTabId);
        metadata.mainTabId = newMainTabId;
        // Hide static indicator on new main tab
        try {
            await this.sendIndicatorMessage(newMainTabId, "HIDE_STATIC_INDICATOR");
            metadata.memberStates.delete(newMainTabId);
        }
        catch {
            // Ignore message errors
        }
        // Transfer indicator state
        if (oldMainState.indicatorState === "pulsing") {
            metadata.memberStates.set(newMainTabId, { indicatorState: "pulsing" });
            await this.sendIndicatorMessage(newMainTabId, "SHOW_AGENT_INDICATORS");
        }
        else {
            metadata.memberStates.set(newMainTabId, { indicatorState: "none" });
        }
        this.groupMetadata.delete(currentMainTabId);
        this.groupMetadata.set(newMainTabId, metadata);
        await this.saveToStorage();
    }
    async deleteGroup(mainTabId) {
        const metadata = this.groupMetadata.get(mainTabId);
        if (!metadata)
            return;
        try {
            const tabs = await chrome.tabs.query({ groupId: metadata.chromeGroupId });
            const tabIds = tabs.map((t) => t.id).filter((id) => id !== undefined);
            if (tabIds.length > 0) {
                try {
                    for (const tab of tabs) {
                        if (tab.id) {
                            try {
                                await chrome.tabs.sendMessage(tab.id, {
                                    type: "HIDE_AGENT_INDICATORS",
                                });
                                await chrome.tabs.sendMessage(tab.id, {
                                    type: "HIDE_STATIC_INDICATOR",
                                });
                            }
                            catch {
                                // Ignore message errors
                            }
                        }
                    }
                }
                catch {
                    // Ignore errors
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
                if (tabIds.length > 0) {
                    await chrome.tabs.ungroup(tabIds);
                }
            }
        }
        catch {
            // Ignore ungroup errors
        }
        this.groupMetadata.delete(mainTabId);
        await this.saveToStorage();
    }
    async clearAllGroups() {
        const mainTabIds = Array.from(this.groupMetadata.keys());
        for (const mainTabId of mainTabIds) {
            await this.deleteGroup(mainTabId);
        }
        this.groupMetadata.clear();
        await this.saveToStorage();
    }
    async clearAll() {
        await this.clearAllGroups();
        this.initialized = false;
    }
    async handleTabClosed(tabId) {
        if (this.groupMetadata.has(tabId)) {
            await this.deleteGroup(tabId);
        }
    }
    async getGroup(mainTabId) {
        return (await this.findGroupByMainTab(mainTabId)) || undefined;
    }
    async updateTabBlocklistStatus(tabId, url) {
        const group = await this.findGroupByTab(tabId);
        if (!group)
            return;
        const isBlockedHtml = url.includes("blocked.html");
        const category = isBlockedHtml
            ? "category1"
            : await W?.getCategory(url);
        await this.updateGroupBlocklistStatus(group.chromeGroupId, tabId, category, isBlockedHtml);
    }
    async removeTabFromBlocklistTracking(groupId, tabId) {
        const status = this.groupBlocklistStatuses.get(groupId);
        if (!status)
            return;
        status.categoriesByTab.delete(tabId);
        status.blockedHtmlTabs.delete(tabId);
        await this.recalculateGroupBlocklistStatus(groupId);
    }
    async updateGroupBlocklistStatus(groupId, tabId, category, isBlockedHtml = false) {
        let status = this.groupBlocklistStatuses.get(groupId);
        if (!status) {
            status = {
                groupId,
                mostRestrictiveCategory: undefined,
                categoriesByTab: new Map(),
                blockedHtmlTabs: new Set(),
                lastChecked: Date.now(),
            };
            this.groupBlocklistStatuses.set(groupId, status);
        }
        status.categoriesByTab.set(tabId, category);
        if (isBlockedHtml) {
            status.blockedHtmlTabs.add(tabId);
        }
        else {
            status.blockedHtmlTabs.delete(tabId);
        }
        await this.recalculateGroupBlocklistStatus(groupId);
    }
    async recalculateGroupBlocklistStatus(groupId) {
        const status = this.groupBlocklistStatuses.get(groupId);
        if (!status)
            return;
        const previousCategory = status.mostRestrictiveCategory;
        const categories = Array.from(status.categoriesByTab.values());
        status.mostRestrictiveCategory = this.getMostRestrictiveCategory(categories);
        status.lastChecked = Date.now();
        if (previousCategory !== status.mostRestrictiveCategory) {
            this.notifyBlocklistListeners(groupId, status.mostRestrictiveCategory);
        }
    }
    getMostRestrictiveCategory(categories) {
        const priority = {
            category3: 2,
            category2: 3,
            category_org_blocked: 3,
            category1: 4,
            category0: 1,
        };
        let mostRestrictive;
        let highestPriority = 0;
        for (const category of categories) {
            if (category && priority[category] > highestPriority) {
                highestPriority = priority[category];
                mostRestrictive = category;
            }
        }
        return mostRestrictive;
    }
    async getGroupBlocklistStatus(mainTabId) {
        await this.initialize();
        const group = await this.findGroupByMainTab(mainTabId);
        if (!group) {
            const tab = await chrome.tabs.get(mainTabId);
            return await W?.getCategory(tab.url || "");
        }
        const status = this.groupBlocklistStatuses.get(group.chromeGroupId);
        if (!status || Date.now() - status.lastChecked > 5000) {
            await this.checkAllTabsInGroupForBlocklist(group.chromeGroupId);
        }
        return this.groupBlocklistStatuses.get(group.chromeGroupId)?.mostRestrictiveCategory;
    }
    async getBlockedTabsInfo(mainTabId) {
        await this.initialize();
        const group = await this.findGroupByMainTab(mainTabId);
        const blockedTabs = [];
        let isMainTabBlocked = false;
        if (!group) {
            const tab = await chrome.tabs.get(mainTabId);
            if (tab.url?.includes("blocked.html")) {
                isMainTabBlocked = true;
                blockedTabs.push({
                    tabId: mainTabId,
                    title: tab.title || "Untitled",
                    url: tab.url || "",
                    category: "category1",
                });
            }
            else {
                const category = await W?.getCategory(tab.url || "");
                if (category && category !== "category0") {
                    isMainTabBlocked = true;
                    blockedTabs.push({
                        tabId: mainTabId,
                        title: tab.title || "Untitled",
                        url: tab.url || "",
                        category,
                    });
                }
            }
            return { isMainTabBlocked, blockedTabs };
        }
        const status = this.groupBlocklistStatuses.get(group.chromeGroupId);
        if (!status || Date.now() - status.lastChecked > 5000) {
            await this.checkAllTabsInGroupForBlocklist(group.chromeGroupId);
        }
        const currentStatus = this.groupBlocklistStatuses.get(group.chromeGroupId);
        if (!currentStatus) {
            return { isMainTabBlocked, blockedTabs };
        }
        for (const blockedTabId of currentStatus.blockedHtmlTabs) {
            try {
                const tab = await chrome.tabs.get(blockedTabId);
                blockedTabs.push({
                    tabId: blockedTabId,
                    title: tab.title || "Untitled",
                    url: tab.url || "",
                    category: "category1",
                });
                if (blockedTabId === mainTabId) {
                    isMainTabBlocked = true;
                }
            }
            catch {
                // Tab may not exist
            }
        }
        for (const [tabId, category] of currentStatus.categoriesByTab.entries()) {
            if (category &&
                (category === "category1" ||
                    category === "category2" ||
                    category === "category_org_blocked") &&
                !currentStatus.blockedHtmlTabs.has(tabId)) {
                try {
                    const tab = await chrome.tabs.get(tabId);
                    blockedTabs.push({
                        tabId,
                        title: tab.title || "Untitled",
                        url: tab.url || "",
                        category,
                    });
                    if (tabId === mainTabId) {
                        isMainTabBlocked = true;
                    }
                }
                catch {
                    // Tab may not exist
                }
            }
        }
        return { isMainTabBlocked, blockedTabs };
    }
    async checkAllTabsInGroupForBlocklist(groupId) {
        const tabs = await chrome.tabs.query({ groupId });
        const status = {
            groupId,
            mostRestrictiveCategory: undefined,
            categoriesByTab: new Map(),
            blockedHtmlTabs: new Set(),
            lastChecked: Date.now(),
        };
        for (const tab of tabs) {
            if (tab.id && tab.url) {
                if (tab.url.includes("blocked.html")) {
                    status.blockedHtmlTabs.add(tab.id);
                    status.categoriesByTab.set(tab.id, "category1");
                }
                else {
                    const category = await W?.getCategory(tab.url);
                    status.categoriesByTab.set(tab.id, category);
                }
            }
        }
        status.mostRestrictiveCategory = this.getMostRestrictiveCategory(Array.from(status.categoriesByTab.values()));
        this.groupBlocklistStatuses.set(groupId, status);
        this.notifyBlocklistListeners(groupId, status.mostRestrictiveCategory);
    }
    addBlocklistListener(listener) {
        this.blocklistListeners.add(listener);
    }
    removeBlocklistListener(listener) {
        this.blocklistListeners.delete(listener);
    }
    notifyBlocklistListeners(groupId, category) {
        for (const listener of this.blocklistListeners) {
            try {
                listener(groupId, category);
            }
            catch {
                // Ignore listener errors
            }
        }
    }
    clearBlocklistCache() {
        this.groupBlocklistStatuses.clear();
    }
    async isTabInSameGroup(tabId1, tabId2) {
        try {
            await this.initialize();
            const mainTabId1 = await this.getMainTabId(tabId1);
            if (!mainTabId1)
                return tabId1 === tabId2;
            const mainTabId2 = await this.getMainTabId(tabId2);
            return mainTabId1 === mainTabId2;
        }
        catch {
            return false;
        }
    }
    async getValidTabIds(tabId) {
        try {
            await this.initialize();
            const mainTabId = await this.getMainTabId(tabId);
            if (!mainTabId)
                return [tabId];
            const details = await this.getGroupDetails(mainTabId);
            return details.memberTabs.map((member) => member.tabId);
        }
        catch {
            return [tabId];
        }
    }
    async getValidTabsWithMetadata(tabId) {
        try {
            const validTabIds = await this.getValidTabIds(tabId);
            return await Promise.all(validTabIds.map(async (id) => {
                try {
                    const tab = await chrome.tabs.get(id);
                    return { id, title: tab.title || "Untitled", url: tab.url || "" };
                }
                catch {
                    return { id, title: "Error loading tab", url: "" };
                }
            }));
        }
        catch {
            try {
                const tab = await chrome.tabs.get(tabId);
                return [{ id: tabId, title: tab.title || "Untitled", url: tab.url || "" }];
            }
            catch {
                return [{ id: tabId, title: "Error loading tab", url: "" }];
            }
        }
    }
    async getEffectiveTabId(requestedTabId, currentTabId) {
        if (requestedTabId === undefined)
            return currentTabId;
        if (!(await this.isTabInSameGroup(currentTabId, requestedTabId))) {
            const validTabIds = await this.getValidTabIds(currentTabId);
            throw new Error(`Tab ${requestedTabId} is not in the same group as the current tab. Valid tab IDs are: ${validTabIds.join(", ")}`);
        }
        return requestedTabId;
    }
    async setTabIndicatorState(tabId, state, isMcp) {
        let chromeGroupId;
        for (const [, metadata] of this.groupMetadata.entries()) {
            const members = await this.getGroupMembers(metadata.chromeGroupId);
            if (members.some((member) => member.tabId === tabId)) {
                chromeGroupId = metadata.chromeGroupId;
                if (state === "static" && (await this.isGroupDismissed(chromeGroupId))) {
                    return;
                }
                const memberState = metadata.memberStates.get(tabId);
                metadata.memberStates.set(tabId, {
                    indicatorState: state,
                    previousIndicatorState: memberState?.indicatorState,
                    isMcp: isMcp ?? memberState?.isMcp,
                });
                break;
            }
        }
        this.queueIndicatorUpdate(tabId, state);
    }
    async setGroupIndicatorState(mainTabId, state) {
        const details = await this.getGroupDetails(mainTabId);
        if (state === "pulsing") {
            await this.setTabIndicatorState(mainTabId, "pulsing");
        }
        else {
            await this.setTabIndicatorState(mainTabId, state);
        }
        for (const member of details.memberTabs) {
            if (member.tabId !== mainTabId) {
                const memberState = state === "none" ? "none" : "static";
                await this.setTabIndicatorState(member.tabId, memberState);
            }
        }
    }
    getTabIndicatorState(tabId) {
        for (const [, metadata] of this.groupMetadata.entries()) {
            const memberState = metadata.memberStates.get(tabId);
            if (memberState) {
                return memberState.indicatorState;
            }
        }
        return "none";
    }
    async showSecondaryTabIndicators(mainTabId) {
        const details = await this.getGroupDetails(mainTabId);
        if (await this.isGroupDismissed(details.chromeGroupId)) {
            return;
        }
        for (const member of details.memberTabs) {
            if (member.tabId !== mainTabId) {
                await this.setTabIndicatorState(member.tabId, "static");
            }
        }
        await this.processIndicatorQueue();
    }
    async showStaticIndicatorsForChromeGroup(chromeGroupId) {
        if (await this.isGroupDismissed(chromeGroupId))
            return;
        const tabs = await chrome.tabs.query({ groupId: chromeGroupId });
        if (tabs.length === 0)
            return;
        let mainTabId;
        for (const [id, metadata] of this.groupMetadata.entries()) {
            if (metadata.chromeGroupId === chromeGroupId) {
                mainTabId = id;
                break;
            }
        }
        if (!mainTabId) {
            tabs.sort((a, b) => a.index - b.index);
            mainTabId = tabs[0].id;
        }
        for (const tab of tabs) {
            if (tab.id && tab.id !== mainTabId) {
                try {
                    await chrome.tabs.sendMessage(tab.id, {
                        type: "SHOW_STATIC_INDICATOR",
                    });
                }
                catch {
                    // Ignore message errors
                }
            }
        }
    }
    async hideSecondaryTabIndicators(mainTabId) {
        try {
            const details = await this.getGroupDetails(mainTabId);
            for (const member of details.memberTabs) {
                if (member.tabId !== mainTabId) {
                    await this.setTabIndicatorState(member.tabId, "none");
                }
            }
            await this.processIndicatorQueue();
        }
        catch {
            // Ignore errors
        }
    }
    async hideIndicatorForToolUse(tabId) {
        try {
            const currentState = this.getTabIndicatorState(tabId);
            for (const [, metadata] of this.groupMetadata.entries()) {
                const memberState = metadata.memberStates.get(tabId);
                if (memberState) {
                    memberState.previousIndicatorState = currentState;
                    memberState.indicatorState = "hidden_for_screenshot";
                    break;
                }
            }
            await this.sendIndicatorMessage(tabId, "HIDE_FOR_TOOL_USE");
        }
        catch {
            // Ignore errors
        }
    }
    async restoreIndicatorAfterToolUse(tabId) {
        try {
            for (const [, metadata] of this.groupMetadata.entries()) {
                const memberState = metadata.memberStates.get(tabId);
                if (memberState && memberState.previousIndicatorState !== undefined) {
                    const previousState = memberState.previousIndicatorState;
                    memberState.indicatorState = previousState;
                    delete memberState.previousIndicatorState;
                    if (previousState === "static") {
                        if (await this.isGroupDismissed(metadata.chromeGroupId)) {
                            return;
                        }
                    }
                    let messageType;
                    switch (previousState) {
                        case "pulsing":
                            messageType = "SHOW_AGENT_INDICATORS";
                            break;
                        case "static":
                            messageType = "SHOW_STATIC_INDICATOR";
                            break;
                        case "none":
                            return;
                        default:
                            messageType = "SHOW_AFTER_TOOL_USE";
                    }
                    await this.sendIndicatorMessage(tabId, messageType);
                    break;
                }
            }
        }
        catch {
            // Ignore errors
        }
    }
    async startRunning(mainTabId) {
        await this.setGroupIndicatorState(mainTabId, "pulsing");
    }
    async stopRunning() {
        for (const [, metadata] of this.groupMetadata.entries()) {
            for (const [tabId] of metadata.memberStates) {
                await this.setTabIndicatorState(tabId, "none");
            }
        }
        await this.processIndicatorQueue();
    }
    async updateGroupTitle(mainTabId, title, showLoading = false) {
        if (!title || title.trim() === "")
            return;
        const metadata = this.groupMetadata.get(mainTabId);
        if (!metadata)
            return;
        try {
            const group = await chrome.tabGroups.get(metadata.chromeGroupId);
            if (group.title !== COMPUTER_CONTROL)
                return;
            const otherGroups = await chrome.tabGroups.query({});
            const usedColors = otherGroups
                .filter((g) => g.id !== metadata.chromeGroupId)
                .map((g) => g.color);
            const allColors = [
                chrome.tabGroups.Color.GREY,
                chrome.tabGroups.Color.BLUE,
                chrome.tabGroups.Color.RED,
                chrome.tabGroups.Color.YELLOW,
                chrome.tabGroups.Color.GREEN,
                chrome.tabGroups.Color.PINK,
                chrome.tabGroups.Color.PURPLE,
                chrome.tabGroups.Color.CYAN,
                chrome.tabGroups.Color.ORANGE,
            ];
            const availableColors = allColors.filter((c) => !usedColors.includes(c));
            let selectedColor;
            if (availableColors.length > 0) {
                selectedColor = availableColors[0];
            }
            else {
                const colorCounts = new Map();
                allColors.forEach((c) => colorCounts.set(c, 0));
                usedColors.forEach((c) => {
                    colorCounts.set(c, (colorCounts.get(c) || 0) + 1);
                });
                let minCount = Infinity;
                selectedColor = chrome.tabGroups.Color.ORANGE;
                for (const [color, count] of colorCounts.entries()) {
                    if (count < minCount) {
                        minCount = count;
                        selectedColor = color;
                    }
                }
            }
            const finalTitle = showLoading ? `\u231B${title.trim()}` : title.trim();
            await chrome.tabGroups.update(metadata.chromeGroupId, {
                title: finalTitle,
                color: selectedColor,
            });
        }
        catch {
            // Ignore update errors
        }
    }
    async updateTabGroupPrefix(mainTabId, newPrefix, requiredPrefix) {
        const metadata = this.groupMetadata.get(mainTabId);
        if (!metadata)
            return;
        let retryCount = 0;
        const prefixRegex = /^(\u231B|\uD83D\uDD14|\u2705)/;
        const attemptUpdate = async () => {
            try {
                const group = await chrome.tabGroups.get(metadata.chromeGroupId);
                const currentTitle = group.title || "";
                if (requiredPrefix && !currentTitle.startsWith(requiredPrefix)) {
                    return;
                }
                if (newPrefix && currentTitle.startsWith(newPrefix)) {
                    return;
                }
                if (!newPrefix && !currentTitle.match(prefixRegex)) {
                    return;
                }
                const titleWithoutPrefix = currentTitle.replace(prefixRegex, "").trim();
                const finalTitle = newPrefix
                    ? `${newPrefix}${titleWithoutPrefix}`
                    : titleWithoutPrefix;
                await chrome.tabGroups.update(metadata.chromeGroupId, { title: finalTitle });
            }
            catch {
                retryCount++;
                if (retryCount <= 3) {
                    await new Promise((resolve) => setTimeout(resolve, 500));
                    return attemptUpdate();
                }
            }
        };
        await attemptUpdate();
    }
    async addCompletionPrefix(mainTabId) {
        await this.updateTabGroupPrefix(mainTabId, "\u2705");
    }
    async addLoadingPrefix(mainTabId) {
        await this.updateTabGroupPrefix(mainTabId, "\u231B");
    }
    async addPermissionPrefix(mainTabId) {
        await this.updateTabGroupPrefix(mainTabId, "\uD83D\uDD14");
    }
    async removeCompletionPrefix(mainTabId) {
        await this.updateTabGroupPrefix(mainTabId, null, "\u2705");
    }
    async removePrefix(mainTabId) {
        await this.updateTabGroupPrefix(mainTabId, null);
    }
    async addTabToIndicatorGroup(options) {
        const { tabId, isRunning, isMcp } = options;
        let state;
        if (this.isMainTab(tabId) && isRunning) {
            state = "pulsing";
        }
        else {
            state = "static";
        }
        await this.setTabIndicatorState(tabId, state, isMcp);
    }
    async getTabForMcp(tabId, tabGroupId) {
        await this.initialize();
        await this.loadMcpTabGroupId();
        if (tabId !== undefined) {
            try {
                const tab = await chrome.tabs.get(tabId);
                if (tab) {
                    const group = await this.findGroupByTab(tabId);
                    let domain;
                    if (group) {
                        this.mcpTabGroupId = group.chromeGroupId;
                        await this.saveMcpTabGroupId();
                        await this.ensureMcpGroupCharacteristics(group.chromeGroupId);
                    }
                    if (tab.url && !tab.url.startsWith("chrome://")) {
                        try {
                            domain = new URL(tab.url).hostname || undefined;
                        }
                        catch {
                            // Ignore URL parse errors
                        }
                    }
                    return { tabId, domain };
                }
            }
            catch {
                throw new Error(`Tab ${tabId} does not exist`);
            }
        }
        if (tabGroupId !== undefined) {
            // Try to find a managed main tab in the group
            for (const [mainTabId, metadata] of this.groupMetadata.entries()) {
                if (metadata.chromeGroupId === tabGroupId) {
                    try {
                        if (await chrome.tabs.get(mainTabId)) {
                            return { tabId: mainTabId, domain: metadata.domain };
                        }
                    }
                    catch {
                        break;
                    }
                }
            }
            // Fall back to first tab in the group
            try {
                const tabs = await chrome.tabs.query({ groupId: tabGroupId });
                if (tabs.length > 0 && tabs[0].id) {
                    let domain;
                    const url = tabs[0].url;
                    if (url && !url.startsWith("chrome://")) {
                        try {
                            domain = new URL(url).hostname || undefined;
                        }
                        catch {
                            // Ignore URL parse errors
                        }
                    }
                    return { tabId: tabs[0].id, domain };
                }
            }
            catch {
                // Ignore query errors
            }
            throw new Error(`Could not find tab group ${tabGroupId}`);
        }
        return { tabId: undefined };
    }
    async isTabMcp(tabId) {
        const mcpConnected = (await chrome.storage.local.get(StorageKeys.MCP_CONNECTED))[StorageKeys.MCP_CONNECTED];
        if (mcpConnected !== true) {
            return false;
        }
        await this.loadMcpTabGroupId();
        if (this.mcpTabGroupId === null) {
            return false;
        }
        for (const [, metadata] of this.groupMetadata.entries()) {
            if (metadata.chromeGroupId === this.mcpTabGroupId &&
                metadata.memberStates.has(tabId)) {
                return true;
            }
        }
        return false;
    }
    async ensureMcpGroupCharacteristics(groupId) {
        try {
            const group = await chrome.tabGroups.get(groupId);
            if (group.title !== MCP ||
                group.color !== chrome.tabGroups.Color.YELLOW) {
                await chrome.tabGroups.update(groupId, {
                    title: MCP,
                    color: chrome.tabGroups.Color.YELLOW,
                });
            }
        }
        catch {
            // Ignore update errors
        }
    }
    async clearMcpTabGroup() {
        this.mcpTabGroupId = null;
        await chrome.storage.local.remove(this.MCP_TAB_GROUP_KEY);
    }
    async getOrCreateMcpTabContext(options) {
        const { createIfEmpty = false } = options || {};
        await this.loadMcpTabGroupId();
        if (this.mcpTabGroupId !== null) {
            try {
                await chrome.tabGroups.get(this.mcpTabGroupId);
                await this.ensureMcpGroupCharacteristics(this.mcpTabGroupId);
                const tabs = await chrome.tabs.query({ groupId: this.mcpTabGroupId });
                const availableTabs = tabs
                    .filter((t) => t.id !== undefined)
                    .map((t) => ({ id: t.id, title: t.title || "", url: t.url || "" }));
                if (availableTabs.length > 0) {
                    return {
                        currentTabId: availableTabs[0].id,
                        availableTabs,
                        tabCount: availableTabs.length,
                        tabGroupId: this.mcpTabGroupId,
                    };
                }
            }
            catch {
                this.mcpTabGroupId = null;
                await this.saveMcpTabGroupId();
            }
        }
        if (createIfEmpty) {
            const window = await chrome.windows.create({
                url: "chrome://newtab",
                focused: true,
                type: "normal",
            });
            const newTabId = window?.tabs?.[0]?.id;
            if (!newTabId) {
                throw new Error("Failed to create window with new tab");
            }
            const group = await this.createGroup(newTabId);
            await chrome.tabGroups.update(group.chromeGroupId, {
                title: MCP,
                color: chrome.tabGroups.Color.YELLOW,
            });
            this.mcpTabGroupId = group.chromeGroupId;
            await this.saveMcpTabGroupId();
            return {
                currentTabId: newTabId,
                availableTabs: [{ id: newTabId, title: "New Tab", url: "chrome://newtab" }],
                tabCount: 1,
                tabGroupId: group.chromeGroupId,
            };
        }
        return undefined;
    }
    async saveMcpTabGroupId() {
        await chrome.storage.local.set({
            [this.MCP_TAB_GROUP_KEY]: this.mcpTabGroupId,
        });
    }
    async loadMcpTabGroupId() {
        try {
            const stored = (await chrome.storage.local.get(this.MCP_TAB_GROUP_KEY))[this.MCP_TAB_GROUP_KEY];
            if (typeof stored === "number") {
                try {
                    await chrome.tabGroups.get(stored);
                    this.mcpTabGroupId = stored;
                    return;
                }
                catch {
                    // Group no longer exists
                }
            }
            // Try to find by characteristics
            const foundGroupId = await this.findMcpTabGroupByCharacteristics();
            if (foundGroupId !== null) {
                this.mcpTabGroupId = foundGroupId;
                await this.saveMcpTabGroupId();
                return;
            }
            this.mcpTabGroupId = null;
        }
        catch {
            this.mcpTabGroupId = null;
        }
    }
    async findMcpTabGroupByCharacteristics() {
        try {
            const groups = await chrome.tabGroups.query({});
            for (const group of groups) {
                if (group.color === chrome.tabGroups.Color.YELLOW &&
                    group.title?.includes(MCP)) {
                    const tabs = await chrome.tabs.query({ groupId: group.id });
                    if (tabs.length > 0) {
                        return group.id;
                    }
                }
            }
            return null;
        }
        catch {
            return null;
        }
    }
    queueIndicatorUpdate(tabId, state) {
        for (const [, metadata] of this.groupMetadata.entries()) {
            const memberState = metadata.memberStates.get(tabId);
            if (memberState) {
                memberState.pendingUpdate = state;
                break;
            }
        }
        if (this.indicatorUpdateTimer) {
            clearTimeout(this.indicatorUpdateTimer);
        }
        this.indicatorUpdateTimer = setTimeout(() => {
            this.processIndicatorQueue();
        }, this.INDICATOR_UPDATE_DELAY);
    }
    async processIndicatorQueue() {
        for (const [, metadata] of this.groupMetadata.entries()) {
            for (const [tabId, memberState] of metadata.memberStates) {
                if (memberState.pendingUpdate) {
                    let messageType;
                    switch (memberState.pendingUpdate) {
                        case "pulsing":
                            messageType = "SHOW_AGENT_INDICATORS";
                            break;
                        case "static":
                            messageType = "SHOW_STATIC_INDICATOR";
                            break;
                        case "none":
                            messageType = "HIDE_AGENT_INDICATORS";
                            break;
                        default:
                            continue;
                    }
                    await this.sendIndicatorMessage(tabId, messageType, memberState.isMcp);
                    delete memberState.pendingUpdate;
                }
            }
        }
    }
    async sendIndicatorMessage(tabId, type, isMcp) {
        try {
            await chrome.tabs.sendMessage(tabId, { type, isMcp });
        }
        catch (error) {
            throw error;
        }
    }
}
// tabGroupManagerInstance = TabGroupManager singleton instance
const tabGroupManagerInstance = TabGroupManager.getInstance();
// Export with full names and backward-compatible single-letter aliases
export { tabGroupManagerInstance, tabGroupManagerInstance as K, TabGroupManager, TabGroupManager as H, COMPUTER_CONTROL, COMPUTER_CONTROL as j, MCP, MCP as z, getTabSubscriptionManagerInstance, getTabSubscriptionManagerInstance as D, TabSubscriptionManager, TabSubscriptionManager as M, };
