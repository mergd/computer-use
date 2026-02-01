/**
 * tab-group-manager.js - Chrome Tab Group Management
 *
 * CLASSES:
 *   M = TabSubscriptionManager - Manages tab event subscriptions
 *   H = TabGroupManager        - Manages Chrome tab groups for MCP sessions
 *
 * SINGLETONS:
 *   D = () => TabSubscriptionManager.getInstance()
 *   K = TabGroupManager.getInstance()
 *
 * EXPORTS:
 *   K (TabGroupManager singleton)
 *   H (TabGroupManager class)
 *   j ("Computer Control" constant)
 *   z ("MCP" constant)
 */
import { S as o } from "./react-core.js";

// DomainCategoryCache is imported from mcp-tools.js
let W = null;
export function setDomainCategoryCache(cache) {
  W = cache;
}

// ============================================================================
// TabSubscriptionManager (class M) - Manages tab event subscriptions
// ============================================================================
class M {
  static instance = null;
  subscriptions = new Map();
  chromeUpdateListener = null;
  chromeActivatedListener = null;
  chromeRemovedListener = null;
  relevantTabIds = new Set();
  nextSubscriptionId = 1;
  constructor() {}
  static getInstance() {
    return (M.instance || (M.instance = new M()), M.instance);
  }
  subscribe(e, t, r) {
    const o = "sub_" + this.nextSubscriptionId++;
    return (
      this.subscriptions.set(o, { tabId: e, eventTypes: t, callback: r }),
      "all" !== e && this.relevantTabIds.add(e),
      1 === this.subscriptions.size && this.startListeners(),
      o
    );
  }
  unsubscribe(e) {
    const t = this.subscriptions.get(e);
    if (t) {
      if ((this.subscriptions.delete(e), "all" !== t.tabId)) {
        let e = !1;
        for (const [, r] of this.subscriptions)
          if (r.tabId === t.tabId) {
            e = !0;
            break;
          }
        e || this.relevantTabIds.delete(t.tabId);
      }
      0 === this.subscriptions.size && this.stopListeners();
    }
  }
  startListeners() {
    ((this.chromeUpdateListener = (e, t, r) => {
      if (this.relevantTabIds.size > 0 && !this.relevantTabIds.has(e)) {
        let e = !1;
        for (const [, t] of this.subscriptions)
          if ("all" === t.tabId) {
            e = !0;
            break;
          }
        if (!e) return;
      }
      const o = {};
      let n = !1;
      if (
        (void 0 !== t.url && ((o.url = t.url), (n = !0)),
        void 0 !== t.status && ((o.status = t.status), (n = !0)),
        "groupId" in t && ((o.groupId = t.groupId), (n = !0)),
        void 0 !== t.title && ((o.title = t.title), (n = !0)),
        n)
      )
        for (const [, a] of this.subscriptions) {
          if ("all" !== a.tabId && a.tabId !== e) continue;
          let t = !1;
          for (const e of a.eventTypes)
            if (void 0 !== o[e]) {
              t = !0;
              break;
            }
          if (t)
            try {
              a.callback(e, o, r);
            } catch (i) {}
        }
    }),
      (this.chromeActivatedListener = (e) => {
        const t = e.tabId;
        if (this.relevantTabIds.size > 0 && !this.relevantTabIds.has(t)) {
          let e = !1;
          for (const [, t] of this.subscriptions)
            if ("all" === t.tabId) {
              e = !0;
              break;
            }
          if (!e) return;
        }
        const r = { active: !0 };
        for (const [, n] of this.subscriptions)
          if (
            ("all" === n.tabId || n.tabId === t) &&
            n.eventTypes.includes("active")
          )
            try {
              n.callback(t, r);
            } catch (o) {}
      }),
      chrome.tabs.onUpdated.addListener(this.chromeUpdateListener),
      chrome.tabs.onActivated.addListener(this.chromeActivatedListener),
      (this.chromeRemovedListener = (e) => {
        if (this.relevantTabIds.size > 0 && !this.relevantTabIds.has(e)) {
          let e = !1;
          for (const [, t] of this.subscriptions)
            if ("all" === t.tabId) {
              e = !0;
              break;
            }
          if (!e) return;
        }
        const t = { removed: !0 };
        for (const [, o] of this.subscriptions)
          if (
            ("all" === o.tabId || o.tabId === e) &&
            o.eventTypes.includes("removed")
          )
            try {
              o.callback(e, t);
            } catch (r) {}
      }),
      chrome.tabs.onRemoved.addListener(this.chromeRemovedListener));
  }
  stopListeners() {
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
  getSubscriptionCount() {
    return this.subscriptions.size;
  }
  hasActiveListeners() {
    return (
      null !== this.chromeUpdateListener ||
      null !== this.chromeActivatedListener ||
      null !== this.chromeRemovedListener
    );
  }
}
const D = () => M.getInstance();

const j = "Computer Control",
  z = "MCP";

// ============================================================================
// TabGroupManager (class H) - Manages Chrome tab groups for MCP sessions
// Singleton accessed via K = H.getInstance()
// ============================================================================
class H {
  static instance;
  groupMetadata = new Map();
  initialized = !1;
  STORAGE_KEY = o.TAB_GROUPS;
  groupBlocklistStatuses = new Map();
  blocklistListeners = new Set();
  indicatorUpdateTimer = null;
  INDICATOR_UPDATE_DELAY = 100;
  pendingRegroups = new Map();
  processingMainTabRemoval = new Set();
  mcpTabGroupId = null;
  MCP_TAB_GROUP_KEY = o.MCP_TAB_GROUP_ID;
  tabGroupListenerSubscriptionId = null;
  isTabGroupListenerStarted = !1;
  DISMISSED_GROUPS_KEY = o.DISMISSED_TAB_GROUPS;
  constructor() {
    this.startTabRemovalListener();
  }
  startTabRemovalListener() {
    chrome.tabs.onRemoved.addListener(async (e) => {
      for (const [t, r] of this.groupBlocklistStatuses.entries())
        r.categoriesByTab.has(e) &&
          (await this.removeTabFromBlocklistTracking(t, e));
    });
  }
  static getInstance() {
    return (H.instance || (H.instance = new H()), H.instance);
  }
  async dismissStaticIndicatorsForGroup(e) {
    const t =
      (await chrome.storage.local.get(this.DISMISSED_GROUPS_KEY))[
        this.DISMISSED_GROUPS_KEY
      ] || [];
    (t.includes(e) || t.push(e),
      await chrome.storage.local.set({ [this.DISMISSED_GROUPS_KEY]: t }));
    try {
      const t = await chrome.tabs.query({ groupId: e });
      for (const e of t)
        if (e.id)
          try {
            await chrome.tabs.sendMessage(e.id, {
              type: "HIDE_STATIC_INDICATOR",
            });
          } catch (r) {}
    } catch (r) {}
  }
  async isGroupDismissed(e) {
    try {
      const t = (await chrome.storage.local.get(this.DISMISSED_GROUPS_KEY))[
        this.DISMISSED_GROUPS_KEY
      ];
      return !!Array.isArray(t) && t.includes(e);
    } catch (t) {
      return !1;
    }
  }
  async initialize(e = !1) {
    (this.initialized && !e) ||
      (await this.loadFromStorage(),
      await this.reconcileWithChrome(),
      (this.initialized = !0));
  }
  startTabGroupChangeListener() {
    if (this.isTabGroupListenerStarted) return;
    const e = D();
    ((this.tabGroupListenerSubscriptionId = e.subscribe(
      "all",
      ["groupId"],
      async (e, t) => {
        "groupId" in t && (await this.handleTabGroupChange(e, t.groupId));
      },
    )),
      (this.isTabGroupListenerStarted = !0));
  }
  stopTabGroupChangeListener() {
    if (!this.isTabGroupListenerStarted || !this.tabGroupListenerSubscriptionId)
      return;
    (D().unsubscribe(this.tabGroupListenerSubscriptionId),
      (this.tabGroupListenerSubscriptionId = null),
      (this.isTabGroupListenerStarted = !1));
  }
  async handleTabGroupChange(e, t) {
    for (const [n, i] of this.groupMetadata.entries())
      if (i.memberStates.has(e)) {
        if (t === chrome.tabGroups.TAB_GROUP_ID_NONE || t !== i.chromeGroupId) {
          const t = i.memberStates.get(e),
            a = t?.indicatorState || "none";
          try {
            let t = "HIDE_AGENT_INDICATORS";
            ("static" === a && (t = "HIDE_STATIC_INDICATOR"),
              await this.sendIndicatorMessage(e, t));
          } catch (r) {}
          if ((i.memberStates.delete(e), e === n)) {
            if (this.processingMainTabRemoval.has(n)) return;
            if (this.pendingRegroups.has(n)) return;
            this.processingMainTabRemoval.add(n);
            const e = i.memberStates.get(n)?.indicatorState || "none",
              t = i.chromeGroupId;
            try {
              const r = await chrome.tabs.group({ tabIds: [n] });
              if (
                (await chrome.tabGroups.update(r, {
                  title: j,
                  color: chrome.tabGroups.Color.ORANGE,
                  collapsed: !1,
                }),
                (i.chromeGroupId = r),
                i.memberStates.clear(),
                i.memberStates.set(n, { indicatorState: e }),
                t !== r && this.groupBlocklistStatuses.delete(t),
                "pulsing" === e)
              )
                try {
                  await this.sendIndicatorMessage(n, "SHOW_AGENT_INDICATORS");
                } catch (o) {}
              return (
                this.groupMetadata.set(n, i),
                await this.saveToStorage(),
                await this.cleanupOldGroup(t, n),
                void this.processingMainTabRemoval.delete(n)
              );
            } catch (r) {
              return r instanceof Error &&
                r.message &&
                r.message.includes("dragging")
                ? (this.pendingRegroups.set(n, {
                    tabId: n,
                    originalGroupId: t,
                    indicatorState: e,
                    metadata: i,
                    attemptCount: 0,
                  }),
                  void this.scheduleRegroupRetry(n))
                : (this.groupMetadata.delete(n),
                  this.groupBlocklistStatuses.delete(t),
                  await this.saveToStorage(),
                  void this.processingMainTabRemoval.delete(n));
            }
          }
          await this.saveToStorage();
          break;
        }
      }
    if (t && t !== chrome.tabGroups.TAB_GROUP_ID_NONE)
      for (const [n, i] of this.groupMetadata.entries())
        if (i.chromeGroupId === t) {
          if (!i.memberStates.has(e)) {
            const t = e !== n;
            i.memberStates.set(e, { indicatorState: t ? "static" : "none" });
            try {
              const t = await chrome.tabs.get(e);
              t.url && (await this.updateTabBlocklistStatus(e, t.url));
            } catch (r) {}
            const o = await this.isGroupDismissed(i.chromeGroupId);
            if (t && !o) {
              let t = 0;
              const o = 3,
                n = 500,
                i = async () => {
                  try {
                    return (
                      await this.sendIndicatorMessage(
                        e,
                        "SHOW_STATIC_INDICATOR",
                      ),
                      !0
                    );
                  } catch (r) {
                    return (t++, t < o && setTimeout(i, n), !1);
                  }
                };
              await i();
            }
            await this.saveToStorage();
          }
          break;
        }
  }
  async cleanupOldGroup(e, t) {
    try {
      const r = await chrome.tabs.query({ groupId: e });
      for (const e of r)
        if (e.id && e.id !== t)
          try {
            await this.sendIndicatorMessage(e.id, "HIDE_STATIC_INDICATOR");
          } catch {}
      const o = r.filter((e) => e.id && e.id !== t).map((e) => e.id);
      o.length > 0 && (await chrome.tabs.ungroup(o));
    } catch (r) {}
  }
  scheduleRegroupRetry(e) {
    const t = this.pendingRegroups.get(e);
    t &&
      (t.timeoutId && clearTimeout(t.timeoutId),
      (t.timeoutId = setTimeout(() => {
        this.attemptRegroup(e);
      }, 1e3)));
  }
  async attemptRegroup(e) {
    const t = this.pendingRegroups.get(e);
    if (t) {
      t.attemptCount++;
      try {
        if (
          (await chrome.tabs.get(e)).groupId !==
          chrome.tabGroups.TAB_GROUP_ID_NONE
        )
          return void this.pendingRegroups.delete(e);
        const o = await chrome.tabs.group({ tabIds: [e] });
        if (
          (await chrome.tabGroups.update(o, {
            title: j,
            color: chrome.tabGroups.Color.ORANGE,
            collapsed: !1,
          }),
          (t.metadata.chromeGroupId = o),
          t.metadata.memberStates.clear(),
          t.metadata.memberStates.set(e, { indicatorState: t.indicatorState }),
          t.originalGroupId !== o &&
            this.groupBlocklistStatuses.delete(t.originalGroupId),
          "pulsing" === t.indicatorState)
        )
          try {
            await this.sendIndicatorMessage(e, "SHOW_AGENT_INDICATORS");
          } catch (r) {}
        (this.groupMetadata.set(e, t.metadata),
          await this.saveToStorage(),
          await this.cleanupOldGroup(t.originalGroupId, e),
          this.pendingRegroups.delete(e),
          this.processingMainTabRemoval.delete(e));
      } catch {
        if (t.attemptCount < 5) this.scheduleRegroupRetry(e);
        else {
          try {
            const o = await chrome.tabs.group({ tabIds: [e] });
            if (
              (await chrome.tabGroups.update(o, {
                title: j,
                color: chrome.tabGroups.Color.ORANGE,
                collapsed: !1,
              }),
              (t.metadata.chromeGroupId = o),
              t.metadata.memberStates.clear(),
              t.metadata.memberStates.set(e, {
                indicatorState: t.indicatorState,
              }),
              t.originalGroupId !== o &&
                this.groupBlocklistStatuses.delete(t.originalGroupId),
              "pulsing" === t.indicatorState)
            )
              try {
                await this.sendIndicatorMessage(e, "SHOW_AGENT_INDICATORS");
              } catch (r) {}
            (this.groupMetadata.set(e, t.metadata),
              await this.saveToStorage(),
              await this.cleanupOldGroup(t.originalGroupId, e));
          } catch (o) {
            (this.groupMetadata.delete(e),
              this.groupBlocklistStatuses.delete(t.originalGroupId),
              await this.saveToStorage());
          }
          (this.pendingRegroups.delete(e),
            this.processingMainTabRemoval.delete(e));
        }
      }
    }
  }
  async loadFromStorage() {
    try {
      const e = (await chrome.storage.local.get(this.STORAGE_KEY))[
        this.STORAGE_KEY
      ];
      e &&
        "object" == typeof e &&
        (this.groupMetadata = new Map(
          Object.entries(e).map(([e, t]) => {
            const r = t;
            return (
              r.memberStates && "object" == typeof r.memberStates
                ? (r.memberStates = new Map(
                    Object.entries(r.memberStates).map(([e, t]) => [
                      parseInt(e),
                      t,
                    ]),
                  ))
                : (r.memberStates = new Map()),
              [parseInt(e), r]
            );
          }),
        ));
    } catch (e) {}
  }
  async saveToStorage() {
    try {
      const e = Object.fromEntries(
        Array.from(this.groupMetadata.entries()).map(([e, t]) => [
          e,
          {
            ...t,
            memberStates: Object.fromEntries(t.memberStates || new Map()),
          },
        ]),
      );
      await chrome.storage.local.set({ [this.STORAGE_KEY]: e });
    } catch (e) {}
  }
  findMainTabInChromeGroup(e) {
    for (const [t, r] of this.groupMetadata.entries())
      if (r.chromeGroupId === e) return t;
    return null;
  }
  async createGroup(e) {
    const t = await this.findGroupByMainTab(e);
    if (t) return t;
    const r = await chrome.tabs.get(e);
    let o,
      n = "blank";
    if (r.url && "" !== r.url && !r.url.startsWith("chrome://"))
      try {
        n = new URL(r.url).hostname || "blank";
      } catch {
        n = "blank";
      }
    if (r.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      this.findMainTabInChromeGroup(r.groupId) ||
        (await chrome.tabs.ungroup([e]));
    }
    let i = 3;
    for (; i > 0; )
      try {
        o = await chrome.tabs.group({ tabIds: [e] });
        break;
      } catch (c) {
        if ((i--, 0 === i)) throw c;
        await new Promise((e) => setTimeout(e, 100));
      }
    if (!o) throw new Error("Failed to create Chrome tab group");
    await chrome.tabGroups.update(o, {
      title: j,
      color: chrome.tabGroups.Color.ORANGE,
      collapsed: !1,
    });
    const a = {
      mainTabId: e,
      createdAt: Date.now(),
      domain: n,
      chromeGroupId: o,
      memberStates: new Map(),
    };
    (a.memberStates.set(e, { indicatorState: "none" }),
      this.groupMetadata.set(e, a),
      await this.saveToStorage());
    const s = await this.getGroupMembers(o);
    return { ...a, memberTabs: s };
  }
  async adoptOrphanedGroup(e, t) {
    const r = await this.findGroupByMainTab(e);
    if (r) return r;
    const o = await chrome.tabs.get(e);
    if (!o.url) throw new Error("Tab has no URL");
    const n = new URL(o.url).hostname;
    if (o.groupId !== t)
      throw new Error(`Tab ${e} is not in Chrome group ${t}`);
    const i = {
      mainTabId: e,
      createdAt: Date.now(),
      domain: n,
      chromeGroupId: t,
      memberStates: new Map(),
    };
    i.memberStates.set(e, { indicatorState: "none" });
    const a = await chrome.tabs.query({ groupId: t });
    for (const c of a)
      c.id &&
        c.id !== e &&
        i.memberStates.set(c.id, { indicatorState: "static" });
    (this.groupMetadata.set(e, i), await this.saveToStorage());
    const s = await this.getGroupMembers(t);
    return { ...i, memberTabs: s };
  }
  async addTabToGroup(e, t) {
    const r = this.groupMetadata.get(e);
    if (r) {
      try {
        (await chrome.tabs.group({ tabIds: [t], groupId: r.chromeGroupId }),
          r.memberStates.has(t) ||
            r.memberStates.set(t, {
              indicatorState: t === e ? "none" : "static",
            }));
        try {
          const e = await chrome.tabs.get(t);
          e.url && (await this.updateTabBlocklistStatus(t, e.url));
        } catch (o) {}
        const n = await this.isGroupDismissed(r.chromeGroupId);
        if (t !== e && !n)
          try {
            await chrome.tabs.sendMessage(t, { type: "SHOW_STATIC_INDICATOR" });
          } catch {}
      } catch (o) {}
      await this.saveToStorage();
    }
  }
  async getGroupMembers(e) {
    const t = await chrome.tabs.query({ groupId: e });
    let r;
    for (const [, o] of this.groupMetadata.entries())
      if (o.chromeGroupId === e) {
        r = o;
        break;
      }
    return t
      .filter((e) => void 0 !== e.id)
      .map((e) => {
        const t = e.id,
          o = r?.memberStates.get(t);
        return {
          tabId: t,
          url: e.url || "",
          title: e.title || "",
          joinedAt: Date.now(),
          indicatorState: o?.indicatorState || "none",
        };
      });
  }
  async getGroupDetails(e) {
    const t = this.groupMetadata.get(e);
    if (!t) throw new Error(`No group found for main tab ${e}`);
    const r = await this.getGroupMembers(t.chromeGroupId);
    return { ...t, memberTabs: r };
  }
  async findOrphanedTabs() {
    const e = [],
      t = new Set(),
      r = await chrome.tabs.query({
        groupId: chrome.tabGroups.TAB_GROUP_ID_NONE,
      }),
      o = new Set();
    for (const [n] of this.groupMetadata.entries()) {
      o.add(n);
      const e = await this.findGroupByMainTab(n);
      e && e.memberTabs.forEach((e) => o.add(e.tabId));
    }
    for (const n of r) {
      if (!n.id || t.has(n.id) || o.has(n.id)) continue;
      t.add(n.id);
      n.openerTabId &&
        o.has(n.openerTabId) &&
        n.url &&
        !n.url.startsWith("chrome://") &&
        !n.url.startsWith("chrome-extension://") &&
        !("about:blank" === n.url) &&
        e.push({
          tabId: n.id,
          url: n.url || "",
          title: n.title || "",
          openerTabId: n.openerTabId,
          detectedAt: Date.now(),
        });
    }
    return e;
  }
  async reconcileWithChrome() {
    const e = await chrome.tabs.query({}),
      t = new Set();
    for (const n of e)
      n.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE && t.add(n.groupId);
    const r = [];
    let o = !1;
    for (const [n, i] of this.groupMetadata.entries())
      try {
        const e = await chrome.tabs.get(n);
        if (t.has(i.chromeGroupId))
          if (e.groupId !== i.chromeGroupId) r.push(n);
          else {
            const e = await chrome.tabs.query({ groupId: i.chromeGroupId }),
              t = new Set(e.map((e) => e.id).filter((e) => void 0 !== e)),
              r = [];
            for (const [o] of i.memberStates) t.has(o) || r.push(o);
            if (r.length > 0) {
              for (const e of r) {
                i.memberStates.delete(e);
                try {
                  await this.sendIndicatorMessage(e, "HIDE_AGENT_INDICATORS");
                } catch {}
              }
              o = !0;
            }
          }
        else r.push(n);
      } catch {
        r.push(n);
      }
    for (const n of r) this.groupMetadata.delete(n);
    (r.length > 0 || o) && (await this.saveToStorage());
  }
  async getAllGroups() {
    await this.initialize();
    const e = [];
    for (const [r, o] of this.groupMetadata.entries())
      try {
        const t = await this.getGroupMembers(o.chromeGroupId);
        e.push({ ...o, memberTabs: t });
      } catch (t) {}
    return e;
  }
  async findGroupByTab(e) {
    await this.initialize();
    const t = this.groupMetadata.get(e);
    if (t) {
      const e = await this.getGroupMembers(t.chromeGroupId);
      return { ...t, memberTabs: e };
    }
    const r = await chrome.tabs.get(e);
    if (r.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return null;
    for (const [, i] of this.groupMetadata.entries())
      if (i.chromeGroupId === r.groupId) {
        const e = await this.getGroupMembers(i.chromeGroupId);
        return { ...i, memberTabs: e };
      }
    const o = await chrome.tabs.query({ groupId: r.groupId });
    if (0 === o.length) return null;
    o.sort((e, t) => e.index - t.index);
    const n = o[0];
    if (!n.id || !n.url) return null;
    return {
      mainTabId: n.id,
      createdAt: Date.now(),
      domain: new URL(n.url).hostname,
      chromeGroupId: r.groupId,
      memberStates: new Map(),
      memberTabs: o
        .filter((e) => void 0 !== e.id)
        .map((e) => ({
          tabId: e.id,
          url: e.url || "",
          title: e.title || "",
          joinedAt: Date.now(),
        })),
      isUnmanaged: !0,
    };
  }
  async findGroupByMainTab(e) {
    await this.initialize();
    const t = this.groupMetadata.get(e);
    if (!t) return null;
    try {
      const e = await this.getGroupMembers(t.chromeGroupId);
      return { ...t, memberTabs: e };
    } catch (r) {
      return null;
    }
  }
  async isInGroup(e) {
    return null !== (await this.findGroupByTab(e));
  }
  isMainTab(e) {
    return this.groupMetadata.has(e);
  }
  async getMainTabId(e) {
    const t = await this.findGroupByTab(e);
    return t?.mainTabId || null;
  }
  async promoteToMainTab(e, t) {
    const r = this.groupMetadata.get(e);
    if (!r) throw new Error(`No group found for main tab ${e}`);
    if ((await chrome.tabs.get(t)).groupId !== r.chromeGroupId)
      throw new Error(`Tab ${t} is not in the same group as ${e}`);
    const o = r.memberStates.get(e) || { indicatorState: "none" };
    try {
      (await chrome.tabs.get(e),
        "pulsing" === o.indicatorState &&
          (await this.sendIndicatorMessage(e, "HIDE_AGENT_INDICATORS")));
    } catch {}
    r.memberStates.get(t);
    r.mainTabId = t;
    try {
      (await this.sendIndicatorMessage(t, "HIDE_STATIC_INDICATOR"),
        r.memberStates.delete(t));
    } catch (n) {}
    ("pulsing" === o.indicatorState
      ? (r.memberStates.set(t, { indicatorState: "pulsing" }),
        await this.sendIndicatorMessage(t, "SHOW_AGENT_INDICATORS"))
      : r.memberStates.set(t, { indicatorState: "none" }),
      this.groupMetadata.delete(e),
      this.groupMetadata.set(t, r),
      await this.saveToStorage());
  }
  async deleteGroup(e) {
    const t = this.groupMetadata.get(e);
    if (t) {
      try {
        const e = await chrome.tabs.query({ groupId: t.chromeGroupId }),
          o = e.map((e) => e.id).filter((e) => void 0 !== e);
        if (o.length > 0)
          try {
            for (const t of e)
              if (t.id)
                try {
                  (await chrome.tabs.sendMessage(t.id, {
                    type: "HIDE_AGENT_INDICATORS",
                  }),
                    await chrome.tabs.sendMessage(t.id, {
                      type: "HIDE_STATIC_INDICATOR",
                    }));
                } catch {}
          } catch (r) {}
        (await new Promise((e) => setTimeout(e, 100)),
          o.length > 0 && (await chrome.tabs.ungroup(o)));
      } catch (r) {}
      (this.groupMetadata.delete(e), await this.saveToStorage());
    }
  }
  async clearAllGroups() {
    const e = Array.from(this.groupMetadata.keys());
    for (const t of e) await this.deleteGroup(t);
    (this.groupMetadata.clear(), await this.saveToStorage());
  }
  async clearAll() {
    (await this.clearAllGroups(), (this.initialized = !1));
  }
  async handleTabClosed(e) {
    this.groupMetadata.has(e) && (await this.deleteGroup(e));
  }
  async getGroup(e) {
    return (await this.findGroupByMainTab(e)) || void 0;
  }
  async updateTabBlocklistStatus(e, t) {
    const r = await this.findGroupByTab(e);
    if (!r) return;
    const o = t.includes("blocked.html"),
      n = o ? "category1" : await W?.getCategory(t);
    await this.updateGroupBlocklistStatus(r.chromeGroupId, e, n, o);
  }
  async removeTabFromBlocklistTracking(e, t) {
    const r = this.groupBlocklistStatuses.get(e);
    r &&
      (r.categoriesByTab.delete(t),
      r.blockedHtmlTabs.delete(t),
      await this.recalculateGroupBlocklistStatus(e));
  }
  async updateGroupBlocklistStatus(e, t, r, o = !1) {
    let n = this.groupBlocklistStatuses.get(e);
    (n ||
      ((n = {
        groupId: e,
        mostRestrictiveCategory: void 0,
        categoriesByTab: new Map(),
        blockedHtmlTabs: new Set(),
        lastChecked: Date.now(),
      }),
      this.groupBlocklistStatuses.set(e, n)),
      n.categoriesByTab.set(t, r),
      o ? n.blockedHtmlTabs.add(t) : n.blockedHtmlTabs.delete(t),
      await this.recalculateGroupBlocklistStatus(e));
  }
  async recalculateGroupBlocklistStatus(e) {
    const t = this.groupBlocklistStatuses.get(e);
    if (!t) return;
    const r = t.mostRestrictiveCategory,
      o = Array.from(t.categoriesByTab.values());
    ((t.mostRestrictiveCategory = this.getMostRestrictiveCategory(o)),
      (t.lastChecked = Date.now()),
      r !== t.mostRestrictiveCategory &&
        this.notifyBlocklistListeners(e, t.mostRestrictiveCategory));
  }
  getMostRestrictiveCategory(e) {
    const t = {
      category3: 2,
      category2: 3,
      category_org_blocked: 3,
      category1: 4,
      category0: 1,
    };
    let r,
      o = 0;
    for (const n of e) n && t[n] > o && ((o = t[n]), (r = n));
    return r;
  }
  async getGroupBlocklistStatus(e) {
    await this.initialize();
    const t = await this.findGroupByMainTab(e);
    if (!t) {
      const t = await chrome.tabs.get(e);
      return await W?.getCategory(t.url || "");
    }
    const r = this.groupBlocklistStatuses.get(t.chromeGroupId);
    return (
      (!r || Date.now() - r.lastChecked > 5e3) &&
        (await this.checkAllTabsInGroupForBlocklist(t.chromeGroupId)),
      this.groupBlocklistStatuses.get(t.chromeGroupId)?.mostRestrictiveCategory
    );
  }
  async getBlockedTabsInfo(e) {
    await this.initialize();
    const t = await this.findGroupByMainTab(e),
      r = [];
    let o = !1;
    if (!t) {
      const t = await chrome.tabs.get(e);
      if (t.url?.includes("blocked.html"))
        ((o = !0),
          r.push({
            tabId: e,
            title: t.title || "Untitled",
            url: t.url || "",
            category: "category1",
          }));
      else {
        const n = await W?.getCategory(t.url || "");
        n &&
          "category0" !== n &&
          ((o = !0),
          r.push({
            tabId: e,
            title: t.title || "Untitled",
            url: t.url || "",
            category: n,
          }));
      }
      return { isMainTabBlocked: o, blockedTabs: r };
    }
    const n = this.groupBlocklistStatuses.get(t.chromeGroupId);
    (!n || Date.now() - n.lastChecked > 5e3) &&
      (await this.checkAllTabsInGroupForBlocklist(t.chromeGroupId));
    const i = this.groupBlocklistStatuses.get(t.chromeGroupId);
    if (!i) return { isMainTabBlocked: o, blockedTabs: r };
    for (const a of i.blockedHtmlTabs)
      try {
        const t = await chrome.tabs.get(a);
        (r.push({
          tabId: a,
          title: t.title || "Untitled",
          url: t.url || "",
          category: "category1",
        }),
          a === e && (o = !0));
      } catch {}
    for (const [a, s] of i.categoriesByTab.entries())
      if (
        s &&
        ("category1" === s ||
          "category2" === s ||
          "category_org_blocked" === s) &&
        !i.blockedHtmlTabs.has(a)
      )
        try {
          const t = await chrome.tabs.get(a);
          (r.push({
            tabId: a,
            title: t.title || "Untitled",
            url: t.url || "",
            category: s,
          }),
            a === e && (o = !0));
        } catch {}
    return { isMainTabBlocked: o, blockedTabs: r };
  }
  async checkAllTabsInGroupForBlocklist(e) {
    const t = await chrome.tabs.query({ groupId: e }),
      r = {
        groupId: e,
        mostRestrictiveCategory: void 0,
        categoriesByTab: new Map(),
        blockedHtmlTabs: new Set(),
        lastChecked: Date.now(),
      };
    for (const o of t)
      if (o.id && o.url)
        if (o.url.includes("blocked.html"))
          (r.blockedHtmlTabs.add(o.id),
            r.categoriesByTab.set(o.id, "category1"));
        else {
          const e = await W?.getCategory(o.url);
          r.categoriesByTab.set(o.id, e);
        }
    ((r.mostRestrictiveCategory = this.getMostRestrictiveCategory(
      Array.from(r.categoriesByTab.values()),
    )),
      this.groupBlocklistStatuses.set(e, r),
      this.notifyBlocklistListeners(e, r.mostRestrictiveCategory));
  }
  addBlocklistListener(e) {
    this.blocklistListeners.add(e);
  }
  removeBlocklistListener(e) {
    this.blocklistListeners.delete(e);
  }
  notifyBlocklistListeners(e, t) {
    for (const o of this.blocklistListeners)
      try {
        o(e, t);
      } catch (r) {}
  }
  clearBlocklistCache() {
    this.groupBlocklistStatuses.clear();
  }
  async isTabInSameGroup(e, t) {
    try {
      await this.initialize();
      const r = await this.getMainTabId(e);
      if (!r) return e === t;
      return r === (await this.getMainTabId(t));
    } catch (r) {
      return !1;
    }
  }
  async getValidTabIds(e) {
    try {
      await this.initialize();
      const t = await this.getMainTabId(e);
      if (!t) return [e];
      return (await this.getGroupDetails(t)).memberTabs.map((e) => e.tabId);
    } catch (t) {
      return [e];
    }
  }
  async getValidTabsWithMetadata(e) {
    try {
      const t = await this.getValidTabIds(e);
      return await Promise.all(
        t.map(async (e) => {
          try {
            const t = await chrome.tabs.get(e);
            return { id: e, title: t.title || "Untitled", url: t.url || "" };
          } catch (t) {
            return { id: e, title: "Error loading tab", url: "" };
          }
        }),
      );
    } catch (t) {
      try {
        const t = await chrome.tabs.get(e);
        return [{ id: e, title: t.title || "Untitled", url: t.url || "" }];
      } catch {
        return [{ id: e, title: "Error loading tab", url: "" }];
      }
    }
  }
  async getEffectiveTabId(e, t) {
    if (void 0 === e) return t;
    if (!(await this.isTabInSameGroup(t, e))) {
      const r = await this.getValidTabIds(t);
      throw new Error(
        `Tab ${e} is not in the same group as the current tab. Valid tab IDs are: ${r.join(", ")}`,
      );
    }
    return e;
  }
  async setTabIndicatorState(e, t, r) {
    let o,
      n = !1;
    for (const [, i] of this.groupMetadata.entries()) {
      if (
        (await this.getGroupMembers(i.chromeGroupId)).some((t) => t.tabId === e)
      ) {
        if (
          ((o = i.chromeGroupId),
          "static" === t && (await this.isGroupDismissed(o)))
        )
          return;
        const a = i.memberStates.get(e);
        (i.memberStates.set(e, {
          indicatorState: t,
          previousIndicatorState: a?.indicatorState,
          isMcp: r ?? a?.isMcp,
        }),
          (n = !0));
        break;
      }
    }
    this.queueIndicatorUpdate(e, t);
  }
  async setGroupIndicatorState(e, t) {
    const r = await this.getGroupDetails(e);
    "pulsing" === t
      ? await this.setTabIndicatorState(e, "pulsing")
      : await this.setTabIndicatorState(e, t);
    for (const o of r.memberTabs)
      if (o.tabId !== e) {
        const e = "none" === t ? "none" : "static";
        await this.setTabIndicatorState(o.tabId, e);
      }
  }
  getTabIndicatorState(e) {
    for (const [, t] of this.groupMetadata.entries()) {
      const r = t.memberStates.get(e);
      if (r) return r.indicatorState;
    }
    return "none";
  }
  async showSecondaryTabIndicators(e) {
    const t = await this.getGroupDetails(e);
    if (!(await this.isGroupDismissed(t.chromeGroupId))) {
      for (const r of t.memberTabs)
        r.tabId !== e && (await this.setTabIndicatorState(r.tabId, "static"));
      await this.processIndicatorQueue();
    }
  }
  async showStaticIndicatorsForChromeGroup(e) {
    if (await this.isGroupDismissed(e)) return;
    const t = await chrome.tabs.query({ groupId: e });
    if (0 === t.length) return;
    let r;
    for (const [n, i] of this.groupMetadata.entries())
      if (i.chromeGroupId === e) {
        r = n;
        break;
      }
    r || (t.sort((e, t) => e.index - t.index), (r = t[0].id));
    for (const n of t)
      if (n.id && n.id !== r)
        try {
          await chrome.tabs.sendMessage(n.id, {
            type: "SHOW_STATIC_INDICATOR",
          });
        } catch (o) {}
  }
  async hideSecondaryTabIndicators(e) {
    try {
      const t = await this.getGroupDetails(e);
      for (const r of t.memberTabs)
        r.tabId !== e && (await this.setTabIndicatorState(r.tabId, "none"));
      await this.processIndicatorQueue();
    } catch (t) {}
  }
  async hideIndicatorForToolUse(e) {
    try {
      const t = this.getTabIndicatorState(e);
      for (const [, r] of this.groupMetadata.entries()) {
        const o = r.memberStates.get(e);
        if (o) {
          ((o.previousIndicatorState = t),
            (o.indicatorState = "hidden_for_screenshot"));
          break;
        }
      }
      await this.sendIndicatorMessage(e, "HIDE_FOR_TOOL_USE");
    } catch (t) {}
  }
  async restoreIndicatorAfterToolUse(e) {
    try {
      for (const [, t] of this.groupMetadata.entries()) {
        const r = t.memberStates.get(e);
        if (r && void 0 !== r.previousIndicatorState) {
          const o = r.previousIndicatorState;
          if (
            ((r.indicatorState = o),
            delete r.previousIndicatorState,
            "static" === o)
          ) {
            if (await this.isGroupDismissed(t.chromeGroupId)) return;
          }
          let n;
          switch (o) {
            case "pulsing":
              n = "SHOW_AGENT_INDICATORS";
              break;
            case "static":
              n = "SHOW_STATIC_INDICATOR";
              break;
            case "none":
              return;
            default:
              n = "SHOW_AFTER_TOOL_USE";
          }
          await this.sendIndicatorMessage(e, n);
          break;
        }
      }
    } catch (t) {}
  }
  async startRunning(e) {
    await this.setGroupIndicatorState(e, "pulsing");
  }
  async stopRunning() {
    for (const [, e] of this.groupMetadata.entries())
      for (const [t] of e.memberStates)
        await this.setTabIndicatorState(t, "none");
    await this.processIndicatorQueue();
  }
  async updateGroupTitle(e, t, r = !1) {
    if (!t || "" === t.trim()) return;
    const o = this.groupMetadata.get(e);
    if (o)
      try {
        if ((await chrome.tabGroups.get(o.chromeGroupId)).title !== j) return;
        const e = (await chrome.tabGroups.query({}))
            .filter((e) => e.id !== o.chromeGroupId)
            .map((e) => e.color),
          n = [
            chrome.tabGroups.Color.GREY,
            chrome.tabGroups.Color.BLUE,
            chrome.tabGroups.Color.RED,
            chrome.tabGroups.Color.YELLOW,
            chrome.tabGroups.Color.GREEN,
            chrome.tabGroups.Color.PINK,
            chrome.tabGroups.Color.PURPLE,
            chrome.tabGroups.Color.CYAN,
            chrome.tabGroups.Color.ORANGE,
          ],
          i = n.filter((t) => !e.includes(t));
        let a;
        if (i.length > 0) a = i[0];
        else {
          const t = new Map();
          (n.forEach((e) => t.set(e, 0)),
            e.forEach((e) => {
              t.set(e, (t.get(e) || 0) + 1);
            }));
          let r = 1 / 0;
          a = chrome.tabGroups.Color.ORANGE;
          for (const [e, o] of t.entries()) o < r && ((r = o), (a = e));
        }
        const s = r ? `\u231B${t.trim()}` : t.trim();
        await chrome.tabGroups.update(o.chromeGroupId, { title: s, color: a });
      } catch (n) {}
  }
  async updateTabGroupPrefix(e, t, r) {
    const o = this.groupMetadata.get(e);
    if (!o) return;
    let n = 0;
    const i = /^(\u231B|\uD83D\uDD14|\u2705)/,
      a = async () => {
        try {
          const e = (await chrome.tabGroups.get(o.chromeGroupId)).title || "";
          if (r && !e.startsWith(r)) return;
          if (t && e.startsWith(t)) return;
          if (!t && !e.match(i)) return;
          const n = e.replace(i, "").trim(),
            a = t ? `${t}${n}` : n;
          await chrome.tabGroups.update(o.chromeGroupId, { title: a });
        } catch (e) {
          if ((n++, n <= 3)) {
            return (await new Promise((e) => setTimeout(e, 500)), a());
          }
        }
      };
    await a();
  }
  async addCompletionPrefix(e) {
    await this.updateTabGroupPrefix(e, "\u2705");
  }
  async addLoadingPrefix(e) {
    await this.updateTabGroupPrefix(e, "\u231B");
  }
  async addPermissionPrefix(e) {
    await this.updateTabGroupPrefix(e, "\uD83D\uDD14");
  }
  async removeCompletionPrefix(e) {
    await this.updateTabGroupPrefix(e, null, "\u2705");
  }
  async removePrefix(e) {
    await this.updateTabGroupPrefix(e, null);
  }
  async addTabToIndicatorGroup(e) {
    const { tabId: t, isRunning: r, isMcp: o } = e;
    let n;
    ((n = this.isMainTab(t) && r ? "pulsing" : "static"),
      await this.setTabIndicatorState(t, n, o));
  }
  async getTabForMcp(e, t) {
    if ((await this.initialize(), await this.loadMcpTabGroupId(), void 0 !== e))
      try {
        const t = await chrome.tabs.get(e);
        if (t) {
          const r = await this.findGroupByTab(e);
          let o;
          if (
            (r &&
              ((this.mcpTabGroupId = r.chromeGroupId),
              await this.saveMcpTabGroupId(),
              await this.ensureMcpGroupCharacteristics(r.chromeGroupId)),
            t.url && !t.url.startsWith("chrome://"))
          )
            try {
              o = new URL(t.url).hostname || void 0;
            } catch {}
          return { tabId: e, domain: o };
        }
      } catch {
        throw new Error(`Tab ${e} does not exist`);
      }
    if (void 0 !== t) {
      for (const [e, r] of this.groupMetadata.entries())
        if (r.chromeGroupId === t)
          try {
            if (await chrome.tabs.get(e)) return { tabId: e, domain: r.domain };
          } catch {
            break;
          }
      try {
        const e = await chrome.tabs.query({ groupId: t });
        if (e.length > 0 && e[0].id) {
          let t;
          const r = e[0].url;
          if (r && !r.startsWith("chrome://"))
            try {
              t = new URL(r).hostname || void 0;
            } catch {}
          return { tabId: e[0].id, domain: t };
        }
      } catch (r) {}
      throw new Error(`Could not find tab group ${t}`);
    }
    return { tabId: void 0 };
  }
  async isTabMcp(e) {
    if (
      !(
        !0 ===
        (await chrome.storage.local.get(o.MCP_CONNECTED))[o.MCP_CONNECTED]
      )
    )
      return !1;
    if ((await this.loadMcpTabGroupId(), null === this.mcpTabGroupId))
      return !1;
    for (const [, t] of this.groupMetadata.entries())
      if (t.chromeGroupId === this.mcpTabGroupId && t.memberStates.has(e))
        return !0;
    return !1;
  }
  async ensureMcpGroupCharacteristics(e) {
    try {
      const t = await chrome.tabGroups.get(e);
      (t.title === z && t.color === chrome.tabGroups.Color.YELLOW) ||
        (await chrome.tabGroups.update(e, {
          title: z,
          color: chrome.tabGroups.Color.YELLOW,
        }));
    } catch (t) {}
  }
  async clearMcpTabGroup() {
    ((this.mcpTabGroupId = null),
      await chrome.storage.local.remove(this.MCP_TAB_GROUP_KEY));
  }
  async getOrCreateMcpTabContext(e) {
    const { createIfEmpty: t = !1 } = e || {};
    if ((await this.loadMcpTabGroupId(), null !== this.mcpTabGroupId))
      try {
        (await chrome.tabGroups.get(this.mcpTabGroupId),
          await this.ensureMcpGroupCharacteristics(this.mcpTabGroupId));
        const e = (await chrome.tabs.query({ groupId: this.mcpTabGroupId }))
          .filter((e) => void 0 !== e.id)
          .map((e) => ({ id: e.id, title: e.title || "", url: e.url || "" }));
        if (e.length > 0)
          return {
            currentTabId: e[0].id,
            availableTabs: e,
            tabCount: e.length,
            tabGroupId: this.mcpTabGroupId,
          };
      } catch {
        ((this.mcpTabGroupId = null), await this.saveMcpTabGroupId());
      }
    if (t) {
      const e = await chrome.windows.create({
          url: "chrome://newtab",
          focused: !0,
          type: "normal",
        }),
        t = e?.tabs?.[0]?.id;
      if (!t) throw new Error("Failed to create window with new tab");
      const r = await this.createGroup(t);
      return (
        await chrome.tabGroups.update(r.chromeGroupId, {
          title: z,
          color: chrome.tabGroups.Color.YELLOW,
        }),
        (this.mcpTabGroupId = r.chromeGroupId),
        await this.saveMcpTabGroupId(),
        {
          currentTabId: t,
          availableTabs: [{ id: t, title: "New Tab", url: "chrome://newtab" }],
          tabCount: 1,
          tabGroupId: r.chromeGroupId,
        }
      );
    }
  }
  async saveMcpTabGroupId() {
    await chrome.storage.local.set({
      [this.MCP_TAB_GROUP_KEY]: this.mcpTabGroupId,
    });
  }
  async loadMcpTabGroupId() {
    try {
      const e = (await chrome.storage.local.get(this.MCP_TAB_GROUP_KEY))[
        this.MCP_TAB_GROUP_KEY
      ];
      if ("number" == typeof e)
        try {
          return (await chrome.tabGroups.get(e), void (this.mcpTabGroupId = e));
        } catch {}
      const t = await this.findMcpTabGroupByCharacteristics();
      if (null !== t)
        return (
          (this.mcpTabGroupId = t),
          void (await this.saveMcpTabGroupId())
        );
      this.mcpTabGroupId = null;
    } catch (e) {
      this.mcpTabGroupId = null;
    }
  }
  async findMcpTabGroupByCharacteristics() {
    try {
      const e = await chrome.tabGroups.query({});
      for (const t of e)
        if (t.color === chrome.tabGroups.Color.YELLOW && t.title?.includes(z)) {
          if ((await chrome.tabs.query({ groupId: t.id })).length > 0)
            return t.id;
        }
      return null;
    } catch (e) {
      return null;
    }
  }
  queueIndicatorUpdate(e, t) {
    for (const [, r] of this.groupMetadata.entries()) {
      const o = r.memberStates.get(e);
      if (o) {
        o.pendingUpdate = t;
        break;
      }
    }
    (this.indicatorUpdateTimer && clearTimeout(this.indicatorUpdateTimer),
      (this.indicatorUpdateTimer = setTimeout(() => {
        this.processIndicatorQueue();
      }, this.INDICATOR_UPDATE_DELAY)));
  }
  async processIndicatorQueue() {
    for (const [, e] of this.groupMetadata.entries())
      for (const [t, r] of e.memberStates)
        if (r.pendingUpdate) {
          let e;
          switch (r.pendingUpdate) {
            case "pulsing":
              e = "SHOW_AGENT_INDICATORS";
              break;
            case "static":
              e = "SHOW_STATIC_INDICATOR";
              break;
            case "none":
              e = "HIDE_AGENT_INDICATORS";
              break;
            default:
              continue;
          }
          (await this.sendIndicatorMessage(t, e, r.isMcp),
            delete r.pendingUpdate);
        }
  }
  async sendIndicatorMessage(e, t, r) {
    try {
      await chrome.tabs.sendMessage(e, { type: t, isMcp: r });
    } catch (o) {
      throw o;
    }
  }
}

// K = TabGroupManager singleton instance
const K = H.getInstance();

export { K, H, j, z, D, M };
