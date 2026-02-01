// @ts-nocheck
/**
 * tab-group-manager.ts - Chrome Tab Group Management
 *
 * CLASSES:
 *   TabSubscriptionManager (M) - Manages tab event subscriptions
 *   TabGroupManager (H)        - Manages Chrome tab groups for MCP sessions
 *
 * SINGLETONS:
 *   getTabSubscriptionManager (D) = () => TabSubscriptionManager.getInstance()
 *   tabGroupManagerInstance (K)   = TabGroupManager.getInstance()
 *
 * EXPORTS:
 *   tabGroupManagerInstance (K) - TabGroupManager singleton
 *   TabGroupManager (H)         - TabGroupManager class
 *   COMPUTER_CONTROL_TITLE (j)  - "Computer Control" constant
 *   MCP_TITLE (z)               - "MCP" constant
 *   getTabSubscriptionManager (D) - TabSubscriptionManager singleton getter
 *   TabSubscriptionManager (M)    - TabSubscriptionManager class
 */

// S is imported from react-core.js - it contains storage key constants
import { S as StorageKeys } from "./storage";

// Types for Chrome extension APIs
type TabId = number;
type GroupId = number;
type SubscriptionId = string;
type EventType = "url" | "status" | "groupId" | "title" | "active" | "removed";
type IndicatorState = "none" | "pulsing" | "static" | "hidden_for_screenshot";
type BlocklistCategory = "category0" | "category1" | "category2" | "category3" | "category_org_blocked" | undefined;

interface TabSubscription {
  tabId: TabId | "all";
  eventTypes: EventType[];
  callback: (tabId: TabId, changes: Record<string, unknown>, tab?: chrome.tabs.Tab) => void;
}

interface TabMemberState {
  indicatorState: IndicatorState;
  previousIndicatorState?: IndicatorState;
  isMcp?: boolean;
  pendingUpdate?: IndicatorState;
}

interface GroupMetadata {
  mainTabId: TabId;
  createdAt: number;
  domain: string;
  chromeGroupId: GroupId;
  memberStates: Map<TabId, TabMemberState>;
}

interface GroupDetails extends GroupMetadata {
  memberTabs: TabMember[];
  isUnmanaged?: boolean;
}

interface TabMember {
  tabId: TabId;
  url: string;
  title: string;
  joinedAt: number;
  indicatorState?: IndicatorState;
}

interface OrphanedTab {
  tabId: TabId;
  url: string;
  title: string;
  openerTabId: TabId;
  detectedAt: number;
}

interface PendingRegroup {
  tabId: TabId;
  originalGroupId: GroupId;
  indicatorState: IndicatorState;
  metadata: GroupMetadata;
  attemptCount: number;
  timeoutId?: ReturnType<typeof setTimeout>;
}

interface GroupBlocklistStatus {
  groupId: GroupId;
  mostRestrictiveCategory: BlocklistCategory;
  categoriesByTab: Map<TabId, BlocklistCategory>;
  blockedHtmlTabs: Set<TabId>;
  lastChecked: number;
}

interface BlockedTabInfo {
  tabId: TabId;
  title: string;
  url: string;
  category: BlocklistCategory;
}

interface McpTabContext {
  currentTabId?: TabId;
  availableTabs: Array<{ id: TabId; title: string; url: string }>;
  tabCount: number;
  tabGroupId?: GroupId;
}

interface DomainCategoryCache {
  getCategory(url: string): Promise<BlocklistCategory>;
}

// DomainCategoryCache is imported from mcp-tools.js
let domainCategoryCache: DomainCategoryCache | null = null;
export function setDomainCategoryCache(cache: DomainCategoryCache): void {
  domainCategoryCache = cache;
}

// ============================================================================
// TabSubscriptionManager (class M) - Manages tab event subscriptions
// ============================================================================
class TabSubscriptionManager {
  static instance: TabSubscriptionManager | null = null;
  subscriptions: Map<SubscriptionId, TabSubscription> = new Map();
  chromeUpdateListener: ((tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void) | null = null;
  chromeActivatedListener: ((activeInfo: chrome.tabs.TabActiveInfo) => void) | null = null;
  chromeRemovedListener: ((tabId: number) => void) | null = null;
  relevantTabIds: Set<TabId> = new Set();
  nextSubscriptionId: number = 1;

  constructor() {}

  static getInstance(): TabSubscriptionManager {
    return (TabSubscriptionManager.instance || (TabSubscriptionManager.instance = new TabSubscriptionManager()), TabSubscriptionManager.instance);
  }

  subscribe(tabIdOrAll: TabId | "all", eventTypes: EventType[], callback: TabSubscription["callback"]): SubscriptionId {
    const subscriptionId: SubscriptionId = "sub_" + this.nextSubscriptionId++;
    return (
      this.subscriptions.set(subscriptionId, { tabId: tabIdOrAll, eventTypes, callback }),
      "all" !== tabIdOrAll && this.relevantTabIds.add(tabIdOrAll),
      1 === this.subscriptions.size && this.startListeners(),
      subscriptionId
    );
  }

  unsubscribe(subscriptionId: SubscriptionId): void {
    const subscription = this.subscriptions.get(subscriptionId);
    if (subscription) {
      if ((this.subscriptions.delete(subscriptionId), "all" !== subscription.tabId)) {
        let hasOtherSubscription = false;
        for (const [, otherSubscription] of this.subscriptions)
          if (otherSubscription.tabId === subscription.tabId) {
            hasOtherSubscription = true;
            break;
          }
        hasOtherSubscription || this.relevantTabIds.delete(subscription.tabId);
      }
      0 === this.subscriptions.size && this.stopListeners();
    }
  }

  startListeners(): void {
    ((this.chromeUpdateListener = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (this.relevantTabIds.size > 0 && !this.relevantTabIds.has(tabId)) {
        let hasAllSubscription = false;
        for (const [, subscription] of this.subscriptions)
          if ("all" === subscription.tabId) {
            hasAllSubscription = true;
            break;
          }
        if (!hasAllSubscription) return;
      }
      const relevantChanges: Record<string, unknown> = {};
      let hasRelevantChanges = false;
      if (
        (void 0 !== changeInfo.url && ((relevantChanges.url = changeInfo.url), (hasRelevantChanges = true)),
        void 0 !== changeInfo.status && ((relevantChanges.status = changeInfo.status), (hasRelevantChanges = true)),
        "groupId" in changeInfo && ((relevantChanges.groupId = changeInfo.groupId), (hasRelevantChanges = true)),
        void 0 !== changeInfo.title && ((relevantChanges.title = changeInfo.title), (hasRelevantChanges = true)),
        hasRelevantChanges)
      )
        for (const [, subscription] of this.subscriptions) {
          if ("all" !== subscription.tabId && subscription.tabId !== tabId) continue;
          let matchesEventType = false;
          for (const eventType of subscription.eventTypes)
            if (void 0 !== relevantChanges[eventType]) {
              matchesEventType = true;
              break;
            }
          if (matchesEventType)
            try {
              subscription.callback(tabId, relevantChanges, tab);
            } catch (_error) {}
        }
    }),
      (this.chromeActivatedListener = (activeInfo: chrome.tabs.TabActiveInfo) => {
        const activatedTabId = activeInfo.tabId;
        if (this.relevantTabIds.size > 0 && !this.relevantTabIds.has(activatedTabId)) {
          let hasAllSubscription = false;
          for (const [, subscription] of this.subscriptions)
            if ("all" === subscription.tabId) {
              hasAllSubscription = true;
              break;
            }
          if (!hasAllSubscription) return;
        }
        const changes = { active: true };
        for (const [, subscription] of this.subscriptions)
          if (
            ("all" === subscription.tabId || subscription.tabId === activatedTabId) &&
            subscription.eventTypes.includes("active")
          )
            try {
              subscription.callback(activatedTabId, changes);
            } catch (_error) {}
      }),
      chrome.tabs.onUpdated.addListener(this.chromeUpdateListener),
      chrome.tabs.onActivated.addListener(this.chromeActivatedListener),
      (this.chromeRemovedListener = (removedTabId: number) => {
        if (this.relevantTabIds.size > 0 && !this.relevantTabIds.has(removedTabId)) {
          let hasAllSubscription = false;
          for (const [, subscription] of this.subscriptions)
            if ("all" === subscription.tabId) {
              hasAllSubscription = true;
              break;
            }
          if (!hasAllSubscription) return;
        }
        const changes = { removed: true };
        for (const [, subscription] of this.subscriptions)
          if (
            ("all" === subscription.tabId || subscription.tabId === removedTabId) &&
            subscription.eventTypes.includes("removed")
          )
            try {
              subscription.callback(removedTabId, changes);
            } catch (_error) {}
      }),
      chrome.tabs.onRemoved.addListener(this.chromeRemovedListener));
  }

  stopListeners(): void {
    (this.chromeUpdateListener &&
      (chrome.tabs.onUpdated.removeListener(this.chromeUpdateListener),
      (this.chromeUpdateListener = null)),
      this.chromeActivatedListener &&
        (chrome.tabs.onActivated.removeListener(this.chromeActivatedListener),
        (this.chromeActivatedListener = null)),
      this.chromeRemovedListener &&
        (chrome.tabs.onRemoved.removeListener(this.chromeRemovedListener),
        (this.chromeRemovedListener = null)),
      this.relevantTabIds.clear());
  }

  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  hasActiveListeners(): boolean {
    return (
      null !== this.chromeUpdateListener ||
      null !== this.chromeActivatedListener ||
      null !== this.chromeRemovedListener
    );
  }
}

const getTabSubscriptionManager = (): TabSubscriptionManager => TabSubscriptionManager.getInstance();

const COMPUTER_CONTROL_TITLE = "Computer Control";
const MCP_TITLE = "MCP";

// ============================================================================
// TabGroupManager (class H) - Manages Chrome tab groups for MCP sessions
// Singleton accessed via tabGroupManagerInstance = TabGroupManager.getInstance()
// ============================================================================
class TabGroupManager {
  static instance: TabGroupManager;
  groupMetadata: Map<TabId, GroupMetadata> = new Map();
  initialized: boolean = false;
  STORAGE_KEY: string = StorageKeys.TAB_GROUPS;
  groupBlocklistStatuses: Map<GroupId, GroupBlocklistStatus> = new Map();
  blocklistListeners: Set<(groupId: GroupId, category: BlocklistCategory) => void> = new Set();
  indicatorUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  INDICATOR_UPDATE_DELAY: number = 100;
  pendingRegroups: Map<TabId, PendingRegroup> = new Map();
  processingMainTabRemoval: Set<TabId> = new Set();
  mcpTabGroupId: GroupId | null = null;
  MCP_TAB_GROUP_KEY: string = StorageKeys.MCP_TAB_GROUP_ID;
  tabGroupListenerSubscriptionId: SubscriptionId | null = null;
  isTabGroupListenerStarted: boolean = false;
  DISMISSED_GROUPS_KEY: string = StorageKeys.DISMISSED_TAB_GROUPS;

  constructor() {
    this.startTabRemovalListener();
  }

  startTabRemovalListener(): void {
    chrome.tabs.onRemoved.addListener(async (removedTabId: number) => {
      for (const [groupId, blocklistStatus] of this.groupBlocklistStatuses.entries())
        blocklistStatus.categoriesByTab.has(removedTabId) &&
          (await this.removeTabFromBlocklistTracking(groupId, removedTabId));
    });
  }

  static getInstance(): TabGroupManager {
    return (TabGroupManager.instance || (TabGroupManager.instance = new TabGroupManager()), TabGroupManager.instance);
  }

  async dismissStaticIndicatorsForGroup(chromeGroupId: GroupId): Promise<void> {
    const dismissedGroups: GroupId[] =
      (await chrome.storage.local.get(this.DISMISSED_GROUPS_KEY))[
        this.DISMISSED_GROUPS_KEY
      ] || [];
    (dismissedGroups.includes(chromeGroupId) || dismissedGroups.push(chromeGroupId),
      await chrome.storage.local.set({ [this.DISMISSED_GROUPS_KEY]: dismissedGroups }));
    try {
      const tabsInGroup = await chrome.tabs.query({ groupId: chromeGroupId });
      for (const tab of tabsInGroup)
        if (tab.id)
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type: "HIDE_STATIC_INDICATOR",
            });
          } catch (_error) {}
    } catch (_error) {}
  }

  async isGroupDismissed(chromeGroupId: GroupId): Promise<boolean> {
    try {
      const dismissedGroups = (await chrome.storage.local.get(this.DISMISSED_GROUPS_KEY))[
        this.DISMISSED_GROUPS_KEY
      ];
      return !!Array.isArray(dismissedGroups) && dismissedGroups.includes(chromeGroupId);
    } catch (_error) {
      return false;
    }
  }

  async initialize(forceReinitialize: boolean = false): Promise<void> {
    (this.initialized && !forceReinitialize) ||
      (await this.loadFromStorage(),
      await this.reconcileWithChrome(),
      (this.initialized = true));
  }

  startTabGroupChangeListener(): void {
    if (this.isTabGroupListenerStarted) return;
    const subscriptionManager = getTabSubscriptionManager();
    ((this.tabGroupListenerSubscriptionId = subscriptionManager.subscribe(
      "all",
      ["groupId"],
      async (tabId: TabId, changes: Record<string, unknown>) => {
        "groupId" in changes && (await this.handleTabGroupChange(tabId, changes.groupId as GroupId));
      },
    )),
      (this.isTabGroupListenerStarted = true));
  }

  stopTabGroupChangeListener(): void {
    if (!this.isTabGroupListenerStarted || !this.tabGroupListenerSubscriptionId)
      return;
    (getTabSubscriptionManager().unsubscribe(this.tabGroupListenerSubscriptionId),
      (this.tabGroupListenerSubscriptionId = null),
      (this.isTabGroupListenerStarted = false));
  }

  async handleTabGroupChange(changedTabId: TabId, newGroupId: GroupId): Promise<void> {
    for (const [mainTabId, metadata] of this.groupMetadata.entries())
      if (metadata.memberStates.has(changedTabId)) {
        if (newGroupId === chrome.tabGroups.TAB_GROUP_ID_NONE || newGroupId !== metadata.chromeGroupId) {
          const memberState = metadata.memberStates.get(changedTabId);
          const currentIndicatorState = memberState?.indicatorState || "none";
          try {
            let hideMessage = "HIDE_AGENT_INDICATORS";
            ("static" === currentIndicatorState && (hideMessage = "HIDE_STATIC_INDICATOR"),
              await this.sendIndicatorMessage(changedTabId, hideMessage));
          } catch (_error) {}
          if ((metadata.memberStates.delete(changedTabId), changedTabId === mainTabId)) {
            if (this.processingMainTabRemoval.has(mainTabId)) return;
            if (this.pendingRegroups.has(mainTabId)) return;
            this.processingMainTabRemoval.add(mainTabId);
            const mainTabIndicatorState = metadata.memberStates.get(mainTabId)?.indicatorState || "none";
            const oldChromeGroupId = metadata.chromeGroupId;
            try {
              const newChromeGroupId = await chrome.tabs.group({ tabIds: [mainTabId] });
              if (
                (await chrome.tabGroups.update(newChromeGroupId, {
                  title: COMPUTER_CONTROL_TITLE,
                  color: chrome.tabGroups.Color.ORANGE,
                  collapsed: false,
                }),
                (metadata.chromeGroupId = newChromeGroupId),
                metadata.memberStates.clear(),
                metadata.memberStates.set(mainTabId, { indicatorState: mainTabIndicatorState }),
                oldChromeGroupId !== newChromeGroupId && this.groupBlocklistStatuses.delete(oldChromeGroupId),
                "pulsing" === mainTabIndicatorState)
              )
                try {
                  await this.sendIndicatorMessage(mainTabId, "SHOW_AGENT_INDICATORS");
                } catch (_error) {}
              return (
                this.groupMetadata.set(mainTabId, metadata),
                await this.saveToStorage(),
                await this.cleanupOldGroup(oldChromeGroupId, mainTabId),
                void this.processingMainTabRemoval.delete(mainTabId)
              );
            } catch (error) {
              return error instanceof Error &&
                error.message &&
                error.message.includes("dragging")
                ? (this.pendingRegroups.set(mainTabId, {
                    tabId: mainTabId,
                    originalGroupId: oldChromeGroupId,
                    indicatorState: mainTabIndicatorState,
                    metadata: metadata,
                    attemptCount: 0,
                  }),
                  void this.scheduleRegroupRetry(mainTabId))
                : (this.groupMetadata.delete(mainTabId),
                  this.groupBlocklistStatuses.delete(oldChromeGroupId),
                  await this.saveToStorage(),
                  void this.processingMainTabRemoval.delete(mainTabId));
            }
          }
          await this.saveToStorage();
          break;
        }
      }
    if (newGroupId && newGroupId !== chrome.tabGroups.TAB_GROUP_ID_NONE)
      for (const [mainTabId, metadata] of this.groupMetadata.entries())
        if (metadata.chromeGroupId === newGroupId) {
          if (!metadata.memberStates.has(changedTabId)) {
            const isSecondaryTab = changedTabId !== mainTabId;
            metadata.memberStates.set(changedTabId, { indicatorState: isSecondaryTab ? "static" : "none" });
            try {
              const tab = await chrome.tabs.get(changedTabId);
              tab.url && (await this.updateTabBlocklistStatus(changedTabId, tab.url));
            } catch (_error) {}
            const isDismissed = await this.isGroupDismissed(metadata.chromeGroupId);
            if (isSecondaryTab && !isDismissed) {
              let retryCount = 0;
              const maxRetries = 3;
              const retryDelay = 500;
              const attemptShowIndicator = async (): Promise<boolean> => {
                try {
                  return (
                    await this.sendIndicatorMessage(
                      changedTabId,
                      "SHOW_STATIC_INDICATOR",
                    ),
                    true
                  );
                } catch (_error) {
                  return (retryCount++, retryCount < maxRetries && setTimeout(attemptShowIndicator, retryDelay), false);
                }
              };
              await attemptShowIndicator();
            }
            await this.saveToStorage();
          }
          break;
        }
  }

  async cleanupOldGroup(oldChromeGroupId: GroupId, excludeTabId: TabId): Promise<void> {
    try {
      const tabsInOldGroup = await chrome.tabs.query({ groupId: oldChromeGroupId });
      for (const tab of tabsInOldGroup)
        if (tab.id && tab.id !== excludeTabId)
          try {
            await this.sendIndicatorMessage(tab.id, "HIDE_STATIC_INDICATOR");
          } catch {}
      const tabIdsToUngroup = tabsInOldGroup.filter((tab) => tab.id && tab.id !== excludeTabId).map((tab) => tab.id) as number[];
      tabIdsToUngroup.length > 0 && (await chrome.tabs.ungroup(tabIdsToUngroup));
    } catch (_error) {}
  }

  scheduleRegroupRetry(mainTabId: TabId): void {
    const pendingRegroup = this.pendingRegroups.get(mainTabId);
    pendingRegroup &&
      (pendingRegroup.timeoutId && clearTimeout(pendingRegroup.timeoutId),
      (pendingRegroup.timeoutId = setTimeout(() => {
        this.attemptRegroup(mainTabId);
      }, 1000)));
  }

  async attemptRegroup(mainTabId: TabId): Promise<void> {
    const pendingRegroup = this.pendingRegroups.get(mainTabId);
    if (pendingRegroup) {
      pendingRegroup.attemptCount++;
      try {
        if (
          (await chrome.tabs.get(mainTabId)).groupId !==
          chrome.tabGroups.TAB_GROUP_ID_NONE
        )
          return void this.pendingRegroups.delete(mainTabId);
        const newChromeGroupId = await chrome.tabs.group({ tabIds: [mainTabId] });
        if (
          (await chrome.tabGroups.update(newChromeGroupId, {
            title: COMPUTER_CONTROL_TITLE,
            color: chrome.tabGroups.Color.ORANGE,
            collapsed: false,
          }),
          (pendingRegroup.metadata.chromeGroupId = newChromeGroupId),
          pendingRegroup.metadata.memberStates.clear(),
          pendingRegroup.metadata.memberStates.set(mainTabId, { indicatorState: pendingRegroup.indicatorState }),
          pendingRegroup.originalGroupId !== newChromeGroupId &&
            this.groupBlocklistStatuses.delete(pendingRegroup.originalGroupId),
          "pulsing" === pendingRegroup.indicatorState)
        )
          try {
            await this.sendIndicatorMessage(mainTabId, "SHOW_AGENT_INDICATORS");
          } catch (_error) {}
        (this.groupMetadata.set(mainTabId, pendingRegroup.metadata),
          await this.saveToStorage(),
          await this.cleanupOldGroup(pendingRegroup.originalGroupId, mainTabId),
          this.pendingRegroups.delete(mainTabId),
          this.processingMainTabRemoval.delete(mainTabId));
      } catch {
        if (pendingRegroup.attemptCount < 5) this.scheduleRegroupRetry(mainTabId);
        else {
          try {
            const newChromeGroupId = await chrome.tabs.group({ tabIds: [mainTabId] });
            if (
              (await chrome.tabGroups.update(newChromeGroupId, {
                title: COMPUTER_CONTROL_TITLE,
                color: chrome.tabGroups.Color.ORANGE,
                collapsed: false,
              }),
              (pendingRegroup.metadata.chromeGroupId = newChromeGroupId),
              pendingRegroup.metadata.memberStates.clear(),
              pendingRegroup.metadata.memberStates.set(mainTabId, {
                indicatorState: pendingRegroup.indicatorState,
              }),
              pendingRegroup.originalGroupId !== newChromeGroupId &&
                this.groupBlocklistStatuses.delete(pendingRegroup.originalGroupId),
              "pulsing" === pendingRegroup.indicatorState)
            )
              try {
                await this.sendIndicatorMessage(mainTabId, "SHOW_AGENT_INDICATORS");
              } catch (_error) {}
            (this.groupMetadata.set(mainTabId, pendingRegroup.metadata),
              await this.saveToStorage(),
              await this.cleanupOldGroup(pendingRegroup.originalGroupId, mainTabId));
          } catch (_error) {
            (this.groupMetadata.delete(mainTabId),
              this.groupBlocklistStatuses.delete(pendingRegroup.originalGroupId),
              await this.saveToStorage());
          }
          (this.pendingRegroups.delete(mainTabId),
            this.processingMainTabRemoval.delete(mainTabId));
        }
      }
    }
  }

  async loadFromStorage(): Promise<void> {
    try {
      const storedData = (await chrome.storage.local.get(this.STORAGE_KEY))[
        this.STORAGE_KEY
      ];
      storedData &&
        "object" == typeof storedData &&
        (this.groupMetadata = new Map(
          Object.entries(storedData).map(([tabIdStr, data]) => {
            const metadata = data as GroupMetadata;
            return (
              metadata.memberStates && "object" == typeof metadata.memberStates
                ? (metadata.memberStates = new Map(
                    Object.entries(metadata.memberStates).map(([memberTabIdStr, state]) => [
                      parseInt(memberTabIdStr),
                      state as TabMemberState,
                    ]),
                  ))
                : (metadata.memberStates = new Map()),
              [parseInt(tabIdStr), metadata]
            );
          }),
        ));
    } catch (_error) {}
  }

  async saveToStorage(): Promise<void> {
    try {
      const serializedData = Object.fromEntries(
        Array.from(this.groupMetadata.entries()).map(([tabId, metadata]) => [
          tabId,
          {
            ...metadata,
            memberStates: Object.fromEntries(metadata.memberStates || new Map()),
          },
        ]),
      );
      await chrome.storage.local.set({ [this.STORAGE_KEY]: serializedData });
    } catch (_error) {}
  }

  findMainTabInChromeGroup(chromeGroupId: GroupId): TabId | null {
    for (const [mainTabId, metadata] of this.groupMetadata.entries())
      if (metadata.chromeGroupId === chromeGroupId) return mainTabId;
    return null;
  }

  async createGroup(tabId: TabId): Promise<GroupDetails> {
    const existingGroup = await this.findGroupByMainTab(tabId);
    if (existingGroup) return existingGroup;
    const tab = await chrome.tabs.get(tabId);
    let chromeGroupId: GroupId | undefined;
    let domain = "blank";
    if (tab.url && "" !== tab.url && !tab.url.startsWith("chrome://"))
      try {
        domain = new URL(tab.url).hostname || "blank";
      } catch {
        domain = "blank";
      }
    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      this.findMainTabInChromeGroup(tab.groupId) ||
        (await chrome.tabs.ungroup([tabId]));
    }
    let retryCount = 3;
    for (; retryCount > 0; )
      try {
        chromeGroupId = await chrome.tabs.group({ tabIds: [tabId] });
        break;
      } catch (error) {
        if ((retryCount--, 0 === retryCount)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    if (!chromeGroupId) throw new Error("Failed to create Chrome tab group");
    await chrome.tabGroups.update(chromeGroupId, {
      title: COMPUTER_CONTROL_TITLE,
      color: chrome.tabGroups.Color.ORANGE,
      collapsed: false,
    });
    const newMetadata: GroupMetadata = {
      mainTabId: tabId,
      createdAt: Date.now(),
      domain: domain,
      chromeGroupId: chromeGroupId,
      memberStates: new Map(),
    };
    (newMetadata.memberStates.set(tabId, { indicatorState: "none" }),
      this.groupMetadata.set(tabId, newMetadata),
      await this.saveToStorage());
    const memberTabs = await this.getGroupMembers(chromeGroupId);
    return { ...newMetadata, memberTabs: memberTabs };
  }

  async adoptOrphanedGroup(tabId: TabId, chromeGroupId: GroupId): Promise<GroupDetails> {
    const existingGroup = await this.findGroupByMainTab(tabId);
    if (existingGroup) return existingGroup;
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) throw new Error("Tab has no URL");
    const domain = new URL(tab.url).hostname;
    if (tab.groupId !== chromeGroupId)
      throw new Error(`Tab ${tabId} is not in Chrome group ${chromeGroupId}`);
    const newMetadata: GroupMetadata = {
      mainTabId: tabId,
      createdAt: Date.now(),
      domain: domain,
      chromeGroupId: chromeGroupId,
      memberStates: new Map(),
    };
    newMetadata.memberStates.set(tabId, { indicatorState: "none" });
    const tabsInGroup = await chrome.tabs.query({ groupId: chromeGroupId });
    for (const groupTab of tabsInGroup)
      groupTab.id &&
        groupTab.id !== tabId &&
        newMetadata.memberStates.set(groupTab.id, { indicatorState: "static" });
    (this.groupMetadata.set(tabId, newMetadata), await this.saveToStorage());
    const memberTabs = await this.getGroupMembers(chromeGroupId);
    return { ...newMetadata, memberTabs: memberTabs };
  }

  async addTabToGroup(mainTabId: TabId, newTabId: TabId): Promise<void> {
    const metadata = this.groupMetadata.get(mainTabId);
    if (metadata) {
      try {
        (await chrome.tabs.group({ tabIds: [newTabId], groupId: metadata.chromeGroupId }),
          metadata.memberStates.has(newTabId) ||
            metadata.memberStates.set(newTabId, {
              indicatorState: newTabId === mainTabId ? "none" : "static",
            }));
        try {
          const tab = await chrome.tabs.get(newTabId);
          tab.url && (await this.updateTabBlocklistStatus(newTabId, tab.url));
        } catch (_error) {}
        const isDismissed = await this.isGroupDismissed(metadata.chromeGroupId);
        if (newTabId !== mainTabId && !isDismissed)
          try {
            await chrome.tabs.sendMessage(newTabId, { type: "SHOW_STATIC_INDICATOR" });
          } catch {}
      } catch (_error) {}
      await this.saveToStorage();
    }
  }

  async getGroupMembers(chromeGroupId: GroupId): Promise<TabMember[]> {
    const tabsInGroup = await chrome.tabs.query({ groupId: chromeGroupId });
    let foundMetadata: GroupMetadata | undefined;
    for (const [, metadata] of this.groupMetadata.entries())
      if (metadata.chromeGroupId === chromeGroupId) {
        foundMetadata = metadata;
        break;
      }
    return tabsInGroup
      .filter((tab) => void 0 !== tab.id)
      .map((tab) => {
        const tabId = tab.id as TabId;
        const memberState = foundMetadata?.memberStates.get(tabId);
        return {
          tabId: tabId,
          url: tab.url || "",
          title: tab.title || "",
          joinedAt: Date.now(),
          indicatorState: memberState?.indicatorState || "none",
        };
      });
  }

  async getGroupDetails(mainTabId: TabId): Promise<GroupDetails> {
    const metadata = this.groupMetadata.get(mainTabId);
    if (!metadata) throw new Error(`No group found for main tab ${mainTabId}`);
    const memberTabs = await this.getGroupMembers(metadata.chromeGroupId);
    return { ...metadata, memberTabs: memberTabs };
  }

  async findOrphanedTabs(): Promise<OrphanedTab[]> {
    const orphanedTabs: OrphanedTab[] = [];
    const processedTabIds: Set<TabId> = new Set();
    const ungroupedTabs = await chrome.tabs.query({
      groupId: chrome.tabGroups.TAB_GROUP_ID_NONE,
    });
    const knownTabIds: Set<TabId> = new Set();
    for (const [mainTabId] of this.groupMetadata.entries()) {
      knownTabIds.add(mainTabId);
      const groupDetails = await this.findGroupByMainTab(mainTabId);
      groupDetails && groupDetails.memberTabs.forEach((member) => knownTabIds.add(member.tabId));
    }
    for (const tab of ungroupedTabs) {
      if (!tab.id || processedTabIds.has(tab.id) || knownTabIds.has(tab.id)) continue;
      processedTabIds.add(tab.id);
      tab.openerTabId &&
        knownTabIds.has(tab.openerTabId) &&
        tab.url &&
        !tab.url.startsWith("chrome://") &&
        !tab.url.startsWith("chrome-extension://") &&
        !("about:blank" === tab.url) &&
        orphanedTabs.push({
          tabId: tab.id,
          url: tab.url || "",
          title: tab.title || "",
          openerTabId: tab.openerTabId,
          detectedAt: Date.now(),
        });
    }
    return orphanedTabs;
  }

  async reconcileWithChrome(): Promise<void> {
    const allTabs = await chrome.tabs.query({});
    const activeGroupIds: Set<GroupId> = new Set();
    for (const tab of allTabs)
      tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE && activeGroupIds.add(tab.groupId);
    const mainTabsToRemove: TabId[] = [];
    let metadataChanged = false;
    for (const [mainTabId, metadata] of this.groupMetadata.entries())
      try {
        const tab = await chrome.tabs.get(mainTabId);
        if (activeGroupIds.has(metadata.chromeGroupId))
          if (tab.groupId !== metadata.chromeGroupId) mainTabsToRemove.push(mainTabId);
          else {
            const tabsInGroup = await chrome.tabs.query({ groupId: metadata.chromeGroupId });
            const currentTabIds: Set<TabId> = new Set(tabsInGroup.map((t) => t.id).filter((id) => void 0 !== id) as TabId[]);
            const memberTabsToRemove: TabId[] = [];
            for (const [memberTabId] of metadata.memberStates) currentTabIds.has(memberTabId) || memberTabsToRemove.push(memberTabId);
            if (memberTabsToRemove.length > 0) {
              for (const tabIdToRemove of memberTabsToRemove) {
                metadata.memberStates.delete(tabIdToRemove);
                try {
                  await this.sendIndicatorMessage(tabIdToRemove, "HIDE_AGENT_INDICATORS");
                } catch {}
              }
              metadataChanged = true;
            }
          }
        else mainTabsToRemove.push(mainTabId);
      } catch {
        mainTabsToRemove.push(mainTabId);
      }
    for (const mainTabId of mainTabsToRemove) this.groupMetadata.delete(mainTabId);
    (mainTabsToRemove.length > 0 || metadataChanged) && (await this.saveToStorage());
  }

  async getAllGroups(): Promise<GroupDetails[]> {
    await this.initialize();
    const allGroups: GroupDetails[] = [];
    for (const [, metadata] of this.groupMetadata.entries())
      try {
        const memberTabs = await this.getGroupMembers(metadata.chromeGroupId);
        allGroups.push({ ...metadata, memberTabs: memberTabs });
      } catch (_error) {}
    return allGroups;
  }

  async findGroupByTab(tabId: TabId): Promise<GroupDetails | null> {
    await this.initialize();
    const directMetadata = this.groupMetadata.get(tabId);
    if (directMetadata) {
      const memberTabs = await this.getGroupMembers(directMetadata.chromeGroupId);
      return { ...directMetadata, memberTabs: memberTabs };
    }
    const tab = await chrome.tabs.get(tabId);
    if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return null;
    for (const [, metadata] of this.groupMetadata.entries())
      if (metadata.chromeGroupId === tab.groupId) {
        const memberTabs = await this.getGroupMembers(metadata.chromeGroupId);
        return { ...metadata, memberTabs: memberTabs };
      }
    const tabsInGroup = await chrome.tabs.query({ groupId: tab.groupId });
    if (0 === tabsInGroup.length) return null;
    tabsInGroup.sort((a, b) => a.index - b.index);
    const firstTab = tabsInGroup[0];
    if (!firstTab.id || !firstTab.url) return null;
    return {
      mainTabId: firstTab.id,
      createdAt: Date.now(),
      domain: new URL(firstTab.url).hostname,
      chromeGroupId: tab.groupId,
      memberStates: new Map(),
      memberTabs: tabsInGroup
        .filter((t) => void 0 !== t.id)
        .map((t) => ({
          tabId: t.id as TabId,
          url: t.url || "",
          title: t.title || "",
          joinedAt: Date.now(),
        })),
      isUnmanaged: true,
    };
  }

  async findGroupByMainTab(mainTabId: TabId): Promise<GroupDetails | null> {
    await this.initialize();
    const metadata = this.groupMetadata.get(mainTabId);
    if (!metadata) return null;
    try {
      const memberTabs = await this.getGroupMembers(metadata.chromeGroupId);
      return { ...metadata, memberTabs: memberTabs };
    } catch (_error) {
      return null;
    }
  }

  async isInGroup(tabId: TabId): Promise<boolean> {
    return null !== (await this.findGroupByTab(tabId));
  }

  isMainTab(tabId: TabId): boolean {
    return this.groupMetadata.has(tabId);
  }

  async getMainTabId(tabId: TabId): Promise<TabId | null> {
    const groupDetails = await this.findGroupByTab(tabId);
    return groupDetails?.mainTabId || null;
  }

  async promoteToMainTab(currentMainTabId: TabId, newMainTabId: TabId): Promise<void> {
    const metadata = this.groupMetadata.get(currentMainTabId);
    if (!metadata) throw new Error(`No group found for main tab ${currentMainTabId}`);
    if ((await chrome.tabs.get(newMainTabId)).groupId !== metadata.chromeGroupId)
      throw new Error(`Tab ${newMainTabId} is not in the same group as ${currentMainTabId}`);
    const oldMainTabState = metadata.memberStates.get(currentMainTabId) || { indicatorState: "none" };
    try {
      (await chrome.tabs.get(currentMainTabId),
        "pulsing" === oldMainTabState.indicatorState &&
          (await this.sendIndicatorMessage(currentMainTabId, "HIDE_AGENT_INDICATORS")));
    } catch {}
    metadata.memberStates.get(newMainTabId);
    metadata.mainTabId = newMainTabId;
    try {
      (await this.sendIndicatorMessage(newMainTabId, "HIDE_STATIC_INDICATOR"),
        metadata.memberStates.delete(newMainTabId));
    } catch (_error) {}
    ("pulsing" === oldMainTabState.indicatorState
      ? (metadata.memberStates.set(newMainTabId, { indicatorState: "pulsing" }),
        await this.sendIndicatorMessage(newMainTabId, "SHOW_AGENT_INDICATORS"))
      : metadata.memberStates.set(newMainTabId, { indicatorState: "none" }),
      this.groupMetadata.delete(currentMainTabId),
      this.groupMetadata.set(newMainTabId, metadata),
      await this.saveToStorage());
  }

  async deleteGroup(mainTabId: TabId): Promise<void> {
    const metadata = this.groupMetadata.get(mainTabId);
    if (metadata) {
      try {
        const tabsInGroup = await chrome.tabs.query({ groupId: metadata.chromeGroupId });
        const tabIds = tabsInGroup.map((tab) => tab.id).filter((id) => void 0 !== id) as number[];
        if (tabIds.length > 0)
          try {
            for (const tab of tabsInGroup)
              if (tab.id)
                try {
                  (await chrome.tabs.sendMessage(tab.id, {
                    type: "HIDE_AGENT_INDICATORS",
                  }),
                    await chrome.tabs.sendMessage(tab.id, {
                      type: "HIDE_STATIC_INDICATOR",
                    }));
                } catch {}
          } catch (_error) {}
        (await new Promise((resolve) => setTimeout(resolve, 100)),
          tabIds.length > 0 && (await chrome.tabs.ungroup(tabIds)));
      } catch (_error) {}
      (this.groupMetadata.delete(mainTabId), await this.saveToStorage());
    }
  }

  async clearAllGroups(): Promise<void> {
    const mainTabIds = Array.from(this.groupMetadata.keys());
    for (const mainTabId of mainTabIds) await this.deleteGroup(mainTabId);
    (this.groupMetadata.clear(), await this.saveToStorage());
  }

  async clearAll(): Promise<void> {
    (await this.clearAllGroups(), (this.initialized = false));
  }

  async handleTabClosed(tabId: TabId): Promise<void> {
    this.groupMetadata.has(tabId) && (await this.deleteGroup(tabId));
  }

  async getGroup(mainTabId: TabId): Promise<GroupDetails | undefined> {
    return (await this.findGroupByMainTab(mainTabId)) || void 0;
  }

  async updateTabBlocklistStatus(tabId: TabId, url: string): Promise<void> {
    const groupDetails = await this.findGroupByTab(tabId);
    if (!groupDetails) return;
    const isBlockedHtml = url.includes("blocked.html");
    const category: BlocklistCategory = isBlockedHtml ? "category1" : await domainCategoryCache?.getCategory(url);
    await this.updateGroupBlocklistStatus(groupDetails.chromeGroupId, tabId, category, isBlockedHtml);
  }

  async removeTabFromBlocklistTracking(chromeGroupId: GroupId, tabId: TabId): Promise<void> {
    const blocklistStatus = this.groupBlocklistStatuses.get(chromeGroupId);
    blocklistStatus &&
      (blocklistStatus.categoriesByTab.delete(tabId),
      blocklistStatus.blockedHtmlTabs.delete(tabId),
      await this.recalculateGroupBlocklistStatus(chromeGroupId));
  }

  async updateGroupBlocklistStatus(chromeGroupId: GroupId, tabId: TabId, category: BlocklistCategory, isBlockedHtml: boolean = false): Promise<void> {
    let blocklistStatus = this.groupBlocklistStatuses.get(chromeGroupId);
    (blocklistStatus ||
      ((blocklistStatus = {
        groupId: chromeGroupId,
        mostRestrictiveCategory: void 0,
        categoriesByTab: new Map(),
        blockedHtmlTabs: new Set(),
        lastChecked: Date.now(),
      }),
      this.groupBlocklistStatuses.set(chromeGroupId, blocklistStatus)),
      blocklistStatus.categoriesByTab.set(tabId, category),
      isBlockedHtml ? blocklistStatus.blockedHtmlTabs.add(tabId) : blocklistStatus.blockedHtmlTabs.delete(tabId),
      await this.recalculateGroupBlocklistStatus(chromeGroupId));
  }

  async recalculateGroupBlocklistStatus(chromeGroupId: GroupId): Promise<void> {
    const blocklistStatus = this.groupBlocklistStatuses.get(chromeGroupId);
    if (!blocklistStatus) return;
    const previousCategory = blocklistStatus.mostRestrictiveCategory;
    const allCategories = Array.from(blocklistStatus.categoriesByTab.values());
    ((blocklistStatus.mostRestrictiveCategory = this.getMostRestrictiveCategory(allCategories)),
      (blocklistStatus.lastChecked = Date.now()),
      previousCategory !== blocklistStatus.mostRestrictiveCategory &&
        this.notifyBlocklistListeners(chromeGroupId, blocklistStatus.mostRestrictiveCategory));
  }

  getMostRestrictiveCategory(categories: BlocklistCategory[]): BlocklistCategory {
    const categoryPriority: Record<string, number> = {
      category3: 2,
      category2: 3,
      category_org_blocked: 3,
      category1: 4,
      category0: 1,
    };
    let mostRestrictive: BlocklistCategory;
    let highestPriority = 0;
    for (const category of categories) category && categoryPriority[category] > highestPriority && ((highestPriority = categoryPriority[category]), (mostRestrictive = category));
    return mostRestrictive!;
  }

  async getGroupBlocklistStatus(mainTabId: TabId): Promise<BlocklistCategory> {
    await this.initialize();
    const groupDetails = await this.findGroupByMainTab(mainTabId);
    if (!groupDetails) {
      const tab = await chrome.tabs.get(mainTabId);
      return await domainCategoryCache?.getCategory(tab.url || "");
    }
    const blocklistStatus = this.groupBlocklistStatuses.get(groupDetails.chromeGroupId);
    return (
      (!blocklistStatus || Date.now() - blocklistStatus.lastChecked > 5000) &&
        (await this.checkAllTabsInGroupForBlocklist(groupDetails.chromeGroupId)),
      this.groupBlocklistStatuses.get(groupDetails.chromeGroupId)?.mostRestrictiveCategory
    );
  }

  async getBlockedTabsInfo(mainTabId: TabId): Promise<{ isMainTabBlocked: boolean; blockedTabs: BlockedTabInfo[] }> {
    await this.initialize();
    const groupDetails = await this.findGroupByMainTab(mainTabId);
    const blockedTabs: BlockedTabInfo[] = [];
    let isMainTabBlocked = false;
    if (!groupDetails) {
      const tab = await chrome.tabs.get(mainTabId);
      if (tab.url?.includes("blocked.html"))
        ((isMainTabBlocked = true),
          blockedTabs.push({
            tabId: mainTabId,
            title: tab.title || "Untitled",
            url: tab.url || "",
            category: "category1",
          }));
      else {
        const category = await domainCategoryCache?.getCategory(tab.url || "");
        category &&
          "category0" !== category &&
          ((isMainTabBlocked = true),
          blockedTabs.push({
            tabId: mainTabId,
            title: tab.title || "Untitled",
            url: tab.url || "",
            category: category,
          }));
      }
      return { isMainTabBlocked: isMainTabBlocked, blockedTabs: blockedTabs };
    }
    const blocklistStatus = this.groupBlocklistStatuses.get(groupDetails.chromeGroupId);
    (!blocklistStatus || Date.now() - blocklistStatus.lastChecked > 5000) &&
      (await this.checkAllTabsInGroupForBlocklist(groupDetails.chromeGroupId));
    const currentBlocklistStatus = this.groupBlocklistStatuses.get(groupDetails.chromeGroupId);
    if (!currentBlocklistStatus) return { isMainTabBlocked: isMainTabBlocked, blockedTabs: blockedTabs };
    for (const blockedHtmlTabId of currentBlocklistStatus.blockedHtmlTabs)
      try {
        const tab = await chrome.tabs.get(blockedHtmlTabId);
        (blockedTabs.push({
          tabId: blockedHtmlTabId,
          title: tab.title || "Untitled",
          url: tab.url || "",
          category: "category1",
        }),
          blockedHtmlTabId === mainTabId && (isMainTabBlocked = true));
      } catch {}
    for (const [tabId, category] of currentBlocklistStatus.categoriesByTab.entries())
      if (
        category &&
        ("category1" === category ||
          "category2" === category ||
          "category_org_blocked" === category) &&
        !currentBlocklistStatus.blockedHtmlTabs.has(tabId)
      )
        try {
          const tab = await chrome.tabs.get(tabId);
          (blockedTabs.push({
            tabId: tabId,
            title: tab.title || "Untitled",
            url: tab.url || "",
            category: category,
          }),
            tabId === mainTabId && (isMainTabBlocked = true));
        } catch {}
    return { isMainTabBlocked: isMainTabBlocked, blockedTabs: blockedTabs };
  }

  async checkAllTabsInGroupForBlocklist(chromeGroupId: GroupId): Promise<void> {
    const tabsInGroup = await chrome.tabs.query({ groupId: chromeGroupId });
    const newBlocklistStatus: GroupBlocklistStatus = {
      groupId: chromeGroupId,
      mostRestrictiveCategory: void 0,
      categoriesByTab: new Map(),
      blockedHtmlTabs: new Set(),
      lastChecked: Date.now(),
    };
    for (const tab of tabsInGroup)
      if (tab.id && tab.url)
        if (tab.url.includes("blocked.html"))
          (newBlocklistStatus.blockedHtmlTabs.add(tab.id),
            newBlocklistStatus.categoriesByTab.set(tab.id, "category1"));
        else {
          const category = await domainCategoryCache?.getCategory(tab.url);
          newBlocklistStatus.categoriesByTab.set(tab.id, category);
        }
    ((newBlocklistStatus.mostRestrictiveCategory = this.getMostRestrictiveCategory(
      Array.from(newBlocklistStatus.categoriesByTab.values()),
    )),
      this.groupBlocklistStatuses.set(chromeGroupId, newBlocklistStatus),
      this.notifyBlocklistListeners(chromeGroupId, newBlocklistStatus.mostRestrictiveCategory));
  }

  addBlocklistListener(listener: (groupId: GroupId, category: BlocklistCategory) => void): void {
    this.blocklistListeners.add(listener);
  }

  removeBlocklistListener(listener: (groupId: GroupId, category: BlocklistCategory) => void): void {
    this.blocklistListeners.delete(listener);
  }

  notifyBlocklistListeners(chromeGroupId: GroupId, category: BlocklistCategory): void {
    for (const listener of this.blocklistListeners)
      try {
        listener(chromeGroupId, category);
      } catch (_error) {}
  }

  clearBlocklistCache(): void {
    this.groupBlocklistStatuses.clear();
  }

  async isTabInSameGroup(tabId1: TabId, tabId2: TabId): Promise<boolean> {
    try {
      await this.initialize();
      const mainTabId1 = await this.getMainTabId(tabId1);
      if (!mainTabId1) return tabId1 === tabId2;
      return mainTabId1 === (await this.getMainTabId(tabId2));
    } catch (_error) {
      return false;
    }
  }

  async getValidTabIds(tabId: TabId): Promise<TabId[]> {
    try {
      await this.initialize();
      const mainTabId = await this.getMainTabId(tabId);
      if (!mainTabId) return [tabId];
      return (await this.getGroupDetails(mainTabId)).memberTabs.map((member) => member.tabId);
    } catch (_error) {
      return [tabId];
    }
  }

  async getValidTabsWithMetadata(tabId: TabId): Promise<Array<{ id: TabId; title: string; url: string }>> {
    try {
      const validTabIds = await this.getValidTabIds(tabId);
      return await Promise.all(
        validTabIds.map(async (validTabId) => {
          try {
            const tab = await chrome.tabs.get(validTabId);
            return { id: validTabId, title: tab.title || "Untitled", url: tab.url || "" };
          } catch (_error) {
            return { id: validTabId, title: "Error loading tab", url: "" };
          }
        }),
      );
    } catch (_error) {
      try {
        const tab = await chrome.tabs.get(tabId);
        return [{ id: tabId, title: tab.title || "Untitled", url: tab.url || "" }];
      } catch {
        return [{ id: tabId, title: "Error loading tab", url: "" }];
      }
    }
  }

  async getEffectiveTabId(requestedTabId: TabId | undefined, currentTabId: TabId): Promise<TabId> {
    if (void 0 === requestedTabId) return currentTabId;
    if (!(await this.isTabInSameGroup(currentTabId, requestedTabId))) {
      const validTabIds = await this.getValidTabIds(currentTabId);
      throw new Error(
        `Tab ${requestedTabId} is not in the same group as the current tab. Valid tab IDs are: ${validTabIds.join(", ")}`,
      );
    }
    return requestedTabId;
  }

  async setTabIndicatorState(tabId: TabId, indicatorState: IndicatorState, isMcp?: boolean): Promise<void> {
    let chromeGroupId: GroupId | undefined;
    let stateUpdated = false;
    for (const [, metadata] of this.groupMetadata.entries()) {
      if (
        (await this.getGroupMembers(metadata.chromeGroupId)).some((member) => member.tabId === tabId)
      ) {
        if (
          ((chromeGroupId = metadata.chromeGroupId),
          "static" === indicatorState && (await this.isGroupDismissed(chromeGroupId)))
        )
          return;
        const existingState = metadata.memberStates.get(tabId);
        (metadata.memberStates.set(tabId, {
          indicatorState: indicatorState,
          previousIndicatorState: existingState?.indicatorState,
          isMcp: isMcp ?? existingState?.isMcp,
        }),
          (stateUpdated = true));
        break;
      }
    }
    this.queueIndicatorUpdate(tabId, indicatorState);
  }

  async setGroupIndicatorState(mainTabId: TabId, indicatorState: IndicatorState): Promise<void> {
    const groupDetails = await this.getGroupDetails(mainTabId);
    "pulsing" === indicatorState
      ? await this.setTabIndicatorState(mainTabId, "pulsing")
      : await this.setTabIndicatorState(mainTabId, indicatorState);
    for (const member of groupDetails.memberTabs)
      if (member.tabId !== mainTabId) {
        const memberIndicatorState = "none" === indicatorState ? "none" : "static";
        await this.setTabIndicatorState(member.tabId, memberIndicatorState);
      }
  }

  getTabIndicatorState(tabId: TabId): IndicatorState {
    for (const [, metadata] of this.groupMetadata.entries()) {
      const memberState = metadata.memberStates.get(tabId);
      if (memberState) return memberState.indicatorState;
    }
    return "none";
  }

  async showSecondaryTabIndicators(mainTabId: TabId): Promise<void> {
    const groupDetails = await this.getGroupDetails(mainTabId);
    if (!(await this.isGroupDismissed(groupDetails.chromeGroupId))) {
      for (const member of groupDetails.memberTabs)
        member.tabId !== mainTabId && (await this.setTabIndicatorState(member.tabId, "static"));
      await this.processIndicatorQueue();
    }
  }

  async showStaticIndicatorsForChromeGroup(chromeGroupId: GroupId): Promise<void> {
    if (await this.isGroupDismissed(chromeGroupId)) return;
    const tabsInGroup = await chrome.tabs.query({ groupId: chromeGroupId });
    if (0 === tabsInGroup.length) return;
    let mainTabId: TabId | undefined;
    for (const [tabId, metadata] of this.groupMetadata.entries())
      if (metadata.chromeGroupId === chromeGroupId) {
        mainTabId = tabId;
        break;
      }
    mainTabId || (tabsInGroup.sort((a, b) => a.index - b.index), (mainTabId = tabsInGroup[0].id));
    for (const tab of tabsInGroup)
      if (tab.id && tab.id !== mainTabId)
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: "SHOW_STATIC_INDICATOR",
          });
        } catch (_error) {}
  }

  async hideSecondaryTabIndicators(mainTabId: TabId): Promise<void> {
    try {
      const groupDetails = await this.getGroupDetails(mainTabId);
      for (const member of groupDetails.memberTabs)
        member.tabId !== mainTabId && (await this.setTabIndicatorState(member.tabId, "none"));
      await this.processIndicatorQueue();
    } catch (_error) {}
  }

  async hideIndicatorForToolUse(tabId: TabId): Promise<void> {
    try {
      const currentState = this.getTabIndicatorState(tabId);
      for (const [, metadata] of this.groupMetadata.entries()) {
        const memberState = metadata.memberStates.get(tabId);
        if (memberState) {
          ((memberState.previousIndicatorState = currentState),
            (memberState.indicatorState = "hidden_for_screenshot"));
          break;
        }
      }
      await this.sendIndicatorMessage(tabId, "HIDE_FOR_TOOL_USE");
    } catch (_error) {}
  }

  async restoreIndicatorAfterToolUse(tabId: TabId): Promise<void> {
    try {
      for (const [, metadata] of this.groupMetadata.entries()) {
        const memberState = metadata.memberStates.get(tabId);
        if (memberState && void 0 !== memberState.previousIndicatorState) {
          const previousState = memberState.previousIndicatorState;
          if (
            ((memberState.indicatorState = previousState),
            delete memberState.previousIndicatorState,
            "static" === previousState)
          ) {
            if (await this.isGroupDismissed(metadata.chromeGroupId)) return;
          }
          let messageType: string;
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
    } catch (_error) {}
  }

  async startRunning(mainTabId: TabId): Promise<void> {
    await this.setGroupIndicatorState(mainTabId, "pulsing");
  }

  async stopRunning(): Promise<void> {
    for (const [, metadata] of this.groupMetadata.entries())
      for (const [tabId] of metadata.memberStates)
        await this.setTabIndicatorState(tabId, "none");
    await this.processIndicatorQueue();
  }

  async updateGroupTitle(mainTabId: TabId, title: string, showLoadingPrefix: boolean = false): Promise<void> {
    if (!title || "" === title.trim()) return;
    const metadata = this.groupMetadata.get(mainTabId);
    if (metadata)
      try {
        if ((await chrome.tabGroups.get(metadata.chromeGroupId)).title !== COMPUTER_CONTROL_TITLE) return;
        const allGroups = await chrome.tabGroups.query({});
        const usedColors = allGroups
            .filter((group) => group.id !== metadata.chromeGroupId)
            .map((group) => group.color);
        const availableColors = [
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
        const unusedColors = availableColors.filter((color) => !usedColors.includes(color));
        let selectedColor: chrome.tabGroups.ColorEnum;
        if (unusedColors.length > 0) selectedColor = unusedColors[0];
        else {
          const colorCounts = new Map<chrome.tabGroups.ColorEnum, number>();
          (availableColors.forEach((color) => colorCounts.set(color, 0)),
            usedColors.forEach((color) => {
              colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
            }));
          let minCount = Infinity;
          selectedColor = chrome.tabGroups.Color.ORANGE;
          for (const [color, count] of colorCounts.entries()) count < minCount && ((minCount = count), (selectedColor = color));
        }
        const finalTitle = showLoadingPrefix ? `\u231B${title.trim()}` : title.trim();
        await chrome.tabGroups.update(metadata.chromeGroupId, { title: finalTitle, color: selectedColor });
      } catch (_error) {}
  }

  async updateTabGroupPrefix(mainTabId: TabId, newPrefix: string | null, expectedCurrentPrefix?: string): Promise<void> {
    const metadata = this.groupMetadata.get(mainTabId);
    if (!metadata) return;
    let retryCount = 0;
    const prefixPattern = /^(\u231B|\uD83D\uDD14|\u2705)/;
    const attemptUpdate = async (): Promise<void> => {
      try {
        const currentTitle = (await chrome.tabGroups.get(metadata.chromeGroupId)).title || "";
        if (expectedCurrentPrefix && !currentTitle.startsWith(expectedCurrentPrefix)) return;
        if (newPrefix && currentTitle.startsWith(newPrefix)) return;
        if (!newPrefix && !currentTitle.match(prefixPattern)) return;
        const titleWithoutPrefix = currentTitle.replace(prefixPattern, "").trim();
        const updatedTitle = newPrefix ? `${newPrefix}${titleWithoutPrefix}` : titleWithoutPrefix;
        await chrome.tabGroups.update(metadata.chromeGroupId, { title: updatedTitle });
      } catch (_error) {
        if ((retryCount++, retryCount <= 3)) {
          return (await new Promise((resolve) => setTimeout(resolve, 500)), attemptUpdate());
        }
      }
    };
    await attemptUpdate();
  }

  async addCompletionPrefix(mainTabId: TabId): Promise<void> {
    await this.updateTabGroupPrefix(mainTabId, "\u2705");
  }

  async addLoadingPrefix(mainTabId: TabId): Promise<void> {
    await this.updateTabGroupPrefix(mainTabId, "\u231B");
  }

  async addPermissionPrefix(mainTabId: TabId): Promise<void> {
    await this.updateTabGroupPrefix(mainTabId, "\uD83D\uDD14");
  }

  async removeCompletionPrefix(mainTabId: TabId): Promise<void> {
    await this.updateTabGroupPrefix(mainTabId, null, "\u2705");
  }

  async removePrefix(mainTabId: TabId): Promise<void> {
    await this.updateTabGroupPrefix(mainTabId, null);
  }

  async addTabToIndicatorGroup(options: { tabId: TabId; isRunning: boolean; isMcp?: boolean }): Promise<void> {
    const { tabId, isRunning, isMcp } = options;
    let indicatorState: IndicatorState;
    ((indicatorState = this.isMainTab(tabId) && isRunning ? "pulsing" : "static"),
      await this.setTabIndicatorState(tabId, indicatorState, isMcp));
  }

  async getTabForMcp(tabId?: TabId, chromeGroupId?: GroupId): Promise<{ tabId?: TabId; domain?: string }> {
    if ((await this.initialize(), await this.loadMcpTabGroupId(), void 0 !== tabId))
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab) {
          const groupDetails = await this.findGroupByTab(tabId);
          let domain: string | undefined;
          if (
            (groupDetails &&
              ((this.mcpTabGroupId = groupDetails.chromeGroupId),
              await this.saveMcpTabGroupId(),
              await this.ensureMcpGroupCharacteristics(groupDetails.chromeGroupId)),
            tab.url && !tab.url.startsWith("chrome://"))
          )
            try {
              domain = new URL(tab.url).hostname || void 0;
            } catch {}
          return { tabId: tabId, domain: domain };
        }
      } catch {
        throw new Error(`Tab ${tabId} does not exist`);
      }
    if (void 0 !== chromeGroupId) {
      for (const [mainTabId, metadata] of this.groupMetadata.entries())
        if (metadata.chromeGroupId === chromeGroupId)
          try {
            if (await chrome.tabs.get(mainTabId)) return { tabId: mainTabId, domain: metadata.domain };
          } catch {
            break;
          }
      try {
        const tabsInGroup = await chrome.tabs.query({ groupId: chromeGroupId });
        if (tabsInGroup.length > 0 && tabsInGroup[0].id) {
          let domain: string | undefined;
          const url = tabsInGroup[0].url;
          if (url && !url.startsWith("chrome://"))
            try {
              domain = new URL(url).hostname || void 0;
            } catch {}
          return { tabId: tabsInGroup[0].id, domain: domain };
        }
      } catch (_error) {}
      throw new Error(`Could not find tab group ${chromeGroupId}`);
    }
    return { tabId: void 0 };
  }

  async isTabMcp(tabId: TabId): Promise<boolean> {
    if (
      !(
        true ===
        (await chrome.storage.local.get(StorageKeys.MCP_CONNECTED))[StorageKeys.MCP_CONNECTED]
      )
    )
      return false;
    if ((await this.loadMcpTabGroupId(), null === this.mcpTabGroupId))
      return false;
    for (const [, metadata] of this.groupMetadata.entries())
      if (metadata.chromeGroupId === this.mcpTabGroupId && metadata.memberStates.has(tabId))
        return true;
    return false;
  }

  async ensureMcpGroupCharacteristics(chromeGroupId: GroupId): Promise<void> {
    try {
      const group = await chrome.tabGroups.get(chromeGroupId);
      (group.title === MCP_TITLE && group.color === chrome.tabGroups.Color.YELLOW) ||
        (await chrome.tabGroups.update(chromeGroupId, {
          title: MCP_TITLE,
          color: chrome.tabGroups.Color.YELLOW,
        }));
    } catch (_error) {}
  }

  async clearMcpTabGroup(): Promise<void> {
    ((this.mcpTabGroupId = null),
      await chrome.storage.local.remove(this.MCP_TAB_GROUP_KEY));
  }

  async getOrCreateMcpTabContext(options?: { createIfEmpty?: boolean }): Promise<McpTabContext | undefined> {
    const { createIfEmpty = false } = options || {};
    if ((await this.loadMcpTabGroupId(), null !== this.mcpTabGroupId))
      try {
        (await chrome.tabGroups.get(this.mcpTabGroupId),
          await this.ensureMcpGroupCharacteristics(this.mcpTabGroupId));
        const availableTabs = (await chrome.tabs.query({ groupId: this.mcpTabGroupId }))
          .filter((tab) => void 0 !== tab.id)
          .map((tab) => ({ id: tab.id as TabId, title: tab.title || "", url: tab.url || "" }));
        if (availableTabs.length > 0)
          return {
            currentTabId: availableTabs[0].id,
            availableTabs: availableTabs,
            tabCount: availableTabs.length,
            tabGroupId: this.mcpTabGroupId,
          };
      } catch {
        ((this.mcpTabGroupId = null), await this.saveMcpTabGroupId());
      }
    if (createIfEmpty) {
      const newWindow = await chrome.windows.create({
          url: "chrome://newtab",
          focused: true,
          type: "normal",
        });
      const newTabId = newWindow?.tabs?.[0]?.id;
      if (!newTabId) throw new Error("Failed to create window with new tab");
      const groupDetails = await this.createGroup(newTabId);
      return (
        await chrome.tabGroups.update(groupDetails.chromeGroupId, {
          title: MCP_TITLE,
          color: chrome.tabGroups.Color.YELLOW,
        }),
        (this.mcpTabGroupId = groupDetails.chromeGroupId),
        await this.saveMcpTabGroupId(),
        {
          currentTabId: newTabId,
          availableTabs: [{ id: newTabId, title: "New Tab", url: "chrome://newtab" }],
          tabCount: 1,
          tabGroupId: groupDetails.chromeGroupId,
        }
      );
    }
  }

  async saveMcpTabGroupId(): Promise<void> {
    await chrome.storage.local.set({
      [this.MCP_TAB_GROUP_KEY]: this.mcpTabGroupId,
    });
  }

  async loadMcpTabGroupId(): Promise<void> {
    try {
      const storedGroupId = (await chrome.storage.local.get(this.MCP_TAB_GROUP_KEY))[
        this.MCP_TAB_GROUP_KEY
      ];
      if ("number" == typeof storedGroupId)
        try {
          return (await chrome.tabGroups.get(storedGroupId), void (this.mcpTabGroupId = storedGroupId));
        } catch {}
      const foundGroupId = await this.findMcpTabGroupByCharacteristics();
      if (null !== foundGroupId)
        return (
          (this.mcpTabGroupId = foundGroupId),
          void (await this.saveMcpTabGroupId())
        );
      this.mcpTabGroupId = null;
    } catch (_error) {
      this.mcpTabGroupId = null;
    }
  }

  async findMcpTabGroupByCharacteristics(): Promise<GroupId | null> {
    try {
      const allGroups = await chrome.tabGroups.query({});
      for (const group of allGroups)
        if (group.color === chrome.tabGroups.Color.YELLOW && group.title?.includes(MCP_TITLE)) {
          if ((await chrome.tabs.query({ groupId: group.id })).length > 0)
            return group.id;
        }
      return null;
    } catch (_error) {
      return null;
    }
  }

  queueIndicatorUpdate(tabId: TabId, indicatorState: IndicatorState): void {
    for (const [, metadata] of this.groupMetadata.entries()) {
      const memberState = metadata.memberStates.get(tabId);
      if (memberState) {
        memberState.pendingUpdate = indicatorState;
        break;
      }
    }
    (this.indicatorUpdateTimer && clearTimeout(this.indicatorUpdateTimer),
      (this.indicatorUpdateTimer = setTimeout(() => {
        this.processIndicatorQueue();
      }, this.INDICATOR_UPDATE_DELAY)));
  }

  async processIndicatorQueue(): Promise<void> {
    for (const [, metadata] of this.groupMetadata.entries())
      for (const [tabId, memberState] of metadata.memberStates)
        if (memberState.pendingUpdate) {
          let messageType: string;
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
          (await this.sendIndicatorMessage(tabId, messageType, memberState.isMcp),
            delete memberState.pendingUpdate);
        }
  }

  async sendIndicatorMessage(tabId: TabId, messageType: string, isMcp?: boolean): Promise<void> {
    try {
      await chrome.tabs.sendMessage(tabId, { type: messageType, isMcp: isMcp });
    } catch (error) {
      throw error;
    }
  }
}

// tabGroupManagerInstance = TabGroupManager singleton instance
const tabGroupManagerInstance = TabGroupManager.getInstance();

// Export with original names for compatibility
export {
  tabGroupManagerInstance as K,
  TabGroupManager as H,
  COMPUTER_CONTROL_TITLE as j,
  MCP_TITLE as z,
  getTabSubscriptionManager as D,
  TabSubscriptionManager as M
};
