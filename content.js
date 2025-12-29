(() => {
  "use strict";

  if (window.__ChatGPTDictationAutoSendLoaded__) return;
  window.__ChatGPTDictationAutoSendLoaded__ = true;

  const DEBUG = false;
  const log = (...args) => {
    if (DEBUG) console.info("[DictationAutoSend]", ...args);
  };

  const CFG = {
    enabled: true,

    holdToSend: false,
    modifierKey: "Shift",
    modifierGraceMs: 1600,

    autoExpandChatsEnabled: true,
    autoTempChatEnabled: false,

    finalTextTimeoutMs: 25000,
    finalTextQuietMs: 320,

    sendAckTimeoutMs: 4500,

    logClicks: true,
    logBlur: false
  };

  let LOG_N = 0;
  const BOOT_T0 = performance.now();

  function nowMs() {
    return (performance.now() - BOOT_T0) | 0;
  }

  function short(s, n = 140) {
    if (s == null) return "";
    const t = String(s).replace(/\s+/g, " ").trim();
    if (t.length <= n) return t;
    return t.slice(0, n) + "...";
  }

  function tmLog(scope, msg, fields) {
    if (!DEBUG) return;
    LOG_N += 1;
    const t = String(nowMs()).padStart(6, " ");
    let tail = "";
    if (fields && typeof fields === "object") {
      const allow = [
        "heldDuring",
        "holdToSend",
        "shouldSend",
        "ok",
        "changed",
        "timeoutMs",
        "quietMs",
        "stableForMs",
        "len",
        "snapshotLen",
        "finalLen",
        "graceMs",
        "graceActive",
        "inputKind",
        "inputFound"
      ];
      const parts = [];
      for (const k of allow) {
        if (k in fields) parts.push(`${k}=${String(fields[k])}`);
      }
      if ("preview" in fields) parts.push(`preview="${short(fields.preview, 120)}"`);
      if ("snapshot" in fields) parts.push(`snapshot="${short(fields.snapshot, 120)}"`);
      if ("btn" in fields) parts.push(`btn="${short(fields.btn, 160)}"`);
      if (parts.length) tail = " | " + parts.join(" ");
    }
    console.log(`[TM DictationAutoSend] #${LOG_N} ${t} ${scope}: ${msg}${tail}`);
  }

  function qs(sel, root = document) {
    return root.querySelector(sel);
  }

  function qsa(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function norm(s) {
    return String(s || "").toLowerCase();
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function isElementVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none") return false;
    if (cs.visibility === "hidden") return false;
    if (cs.opacity === "0") return false;
    return true;
  }

  function describeEl(el) {
    if (!el) return "null";
    const tag = el.tagName ? el.tagName.toLowerCase() : "node";
    const id = el.id ? `#${el.id}` : "";
    const dt = el.getAttribute ? el.getAttribute("data-testid") : "";
    const aria = el.getAttribute ? el.getAttribute("aria-label") : "";
    const title = el.getAttribute ? el.getAttribute("title") : "";
    const txt = el.textContent ? short(el.textContent, 60) : "";
    const bits = [];
    bits.push(`${tag}${id}`);
    if (dt) bits.push(`data-testid=${dt}`);
    if (aria) bits.push(`aria="${short(aria, 60)}"`);
    if (title) bits.push(`title="${short(title, 60)}"`);
    if (txt) bits.push(`text="${txt}"`);
    return bits.join(" ");
  }

  function humanClick(el, why) {
    if (!el) return false;
    try {
      if (typeof el.focus === "function") el.focus();
    } catch (_) {
    }

    try {
      el.scrollIntoView({ block: "center", inline: "center" });
    } catch (_) {
    }

    const rect = el.getBoundingClientRect();
    const cx = Math.max(1, Math.floor(rect.left + rect.width / 2));
    const cy = Math.max(1, Math.floor(rect.top + rect.height / 2));
    const common = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0 };

    try {
      el.dispatchEvent(new PointerEvent("pointerdown", { ...common, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    } catch (_) {
    }
    try {
      el.dispatchEvent(new MouseEvent("mousedown", common));
    } catch (_) {
    }
    try {
      el.dispatchEvent(new PointerEvent("pointerup", { ...common, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    } catch (_) {
    }
    try {
      el.dispatchEvent(new MouseEvent("mouseup", common));
    } catch (_) {
    }
    try {
      el.dispatchEvent(new MouseEvent("click", common));
    } catch (_) {
    }

    tmLog("UI", `humanClick ${why}`, { preview: describeEl(el) });
    return true;
  }

  function findTextbox() {
    return (
      qs('textarea[data-testid="textbox"]') ||
      qs("textarea#prompt-textarea") ||
      qs("#prompt-textarea") ||
      qs("textarea[data-testid='prompt-textarea']") ||
      qs("textarea[placeholder]") ||
      qs('div[contenteditable="true"][role="textbox"]') ||
      qs('[role="textbox"][contenteditable="true"]') ||
      null
    );
  }

  function readTextboxText(el) {
    if (!el) return "";
    if (el.tagName === "TEXTAREA") return el.value || "";
    return String(el.innerText || el.textContent || "").replace(/\u00A0/g, " ");
  }

  function readInputText() {
    const el = findTextbox();
    if (!el) return { ok: false, kind: "none", text: "" };
    const kind = el.tagName === "TEXTAREA" ? "textarea" : "contenteditable";
    return { ok: true, kind, text: readTextboxText(el) };
  }

  function findSendButton() {
    return (
      qs('[data-testid="send-button"]') ||
      qs("#composer-submit-button") ||
      qs("form button[type='submit']") ||
      qs('button[aria-label*="Send"]') ||
      qs('button[aria-label*="Отправ"]') ||
      null
    );
  }

  function isDisabled(btn) {
    if (!btn) return true;
    if (btn.hasAttribute("disabled")) return true;
    const ariaDisabled = btn.getAttribute("aria-disabled");
    if (ariaDisabled && ariaDisabled !== "false") return true;
    return false;
  }

  function isSubmitDictationButton(btn) {
    if (!btn) return false;
    const a = norm(btn.getAttribute("aria-label"));
    const t = norm(btn.getAttribute("title"));
    const dt = norm(btn.getAttribute("data-testid"));
    const txt = norm(btn.textContent);

    if (a.includes("submit dictation")) return true;
    if (a.includes("dictation") && (a.includes("submit") || a.includes("accept") || a.includes("confirm"))) return true;

    if (a.includes("готово")) return true;
    if (a.includes("подтверд")) return true;
    if (a.includes("принять")) return true;

    if (dt.includes("dictation") && (dt.includes("submit") || dt.includes("done") || dt.includes("finish"))) return true;

    if (t.includes("submit dictation")) return true;
    if (txt.includes("submit dictation")) return true;

    return false;
  }

  function findStopGeneratingButton() {
    const candidates = qsa("button").filter((b) => {
      const a = norm(b.getAttribute("aria-label"));
      const t = norm(b.getAttribute("title"));
      const dt = norm(b.getAttribute("data-testid"));
      if (dt.includes("stop")) return true;
      if (a.includes("stop generating")) return true;
      if (a.includes("stop")) return true;
      if (a.includes("останов")) return true;
      if (t.includes("stop")) return true;
      if (t.includes("останов")) return true;
      return false;
    });
    for (const b of candidates) {
      if (isVisible(b)) return b;
    }
    return null;
  }

  function keyMatchesModifier(e) {
    if (!CFG.modifierKey || CFG.modifierKey === "None") return false;
    if (CFG.modifierKey === "Control") return e && (e.key === "Control" || e.key === "Ctrl");
    return e && e.key === CFG.modifierKey;
  }

  function isModifierHeldNow() {
    if (!CFG.modifierKey || CFG.modifierKey === "None") return false;
    if (CFG.modifierKey === "Control") return keyState.ctrl;
    if (CFG.modifierKey === "Alt") return keyState.alt;
    return keyState.shift;
  }

  function isModifierHeldFromEvent(e) {
    if (!CFG.modifierKey || CFG.modifierKey === "None") return false;
    if (!e) return false;
    if (CFG.modifierKey === "Control") return !!e.ctrlKey;
    if (CFG.modifierKey === "Alt") return !!e.altKey;
    return !!e.shiftKey;
  }

  const keyState = { shift: false, ctrl: false, alt: false };
  let tempChatEnabled = false;

  function updateKeyState(e, state) {
    if (e.key === "Shift") keyState.shift = state;
    if (e.key === "Control" || e.key === "Ctrl") keyState.ctrl = state;
    if (e.key === "Alt") keyState.alt = state;
  }

  window.addEventListener(
    "keydown",
    (e) => {
      updateKeyState(e, true);
      if (keyMatchesModifier(e)) {
        const graceActive = performance.now() <= graceUntilMs;
        if (graceActive) graceCaptured = true;
        tmLog("KEY", "down modifier", { graceActive, graceMs: CFG.modifierGraceMs });
      }
    },
    true
  );

  window.addEventListener(
    "keyup",
    (e) => {
      updateKeyState(e, false);
      if (keyMatchesModifier(e)) {
        tmLog("KEY", "up modifier");
      }
    },
    true
  );

  let lastBlurLogAt = 0;
  window.addEventListener(
    "blur",
    () => {
      keyState.shift = false;
      keyState.ctrl = false;
      keyState.alt = false;
      if (!CFG.logBlur) return;
      const t = performance.now();
      if (t - lastBlurLogAt > 800) {
        lastBlurLogAt = t;
        tmLog("KEY", "window blur reset modifier");
      }
    },
    true
  );

  function waitForFinalText({ snapshot, timeoutMs, quietMs }) {
    return new Promise((resolve) => {
      const t0 = performance.now();

      const first = readInputText();
      let lastText = first.text;
      let lastChangeAt = performance.now();

      tmLog("WAIT", "waitForFinalText start", {
        timeoutMs,
        quietMs,
        inputFound: first.ok,
        inputKind: first.kind,
        snapshotLen: (snapshot || "").length,
        len: lastText.length,
        preview: lastText,
        snapshot: snapshot || ""
      });

      const tick = () => {
        const cur = readInputText();
        const v = cur.text;

        if (v !== lastText) {
          lastText = v;
          lastChangeAt = performance.now();
          tmLog("WAIT", "input changed", { inputFound: cur.ok, inputKind: cur.kind, len: v.length, preview: v });
        }

        const stableForMs = (performance.now() - lastChangeAt) | 0;

        const changed = snapshot && snapshot.length > 0 ? v !== snapshot : v.trim().length > 0;

        if (changed && stableForMs >= quietMs) {
          tmLog("WAIT", "final text stable", {
            stableForMs,
            changed: true,
            finalLen: v.length,
            inputFound: cur.ok,
            inputKind: cur.kind
          });
          resolve({ ok: true, text: v, kind: cur.kind, inputOk: cur.ok });
          return;
        }

        if (performance.now() - t0 > timeoutMs) {
          tmLog("WAIT", "final text timeout", {
            changed: snapshot && snapshot.length > 0 ? v !== snapshot : v.trim().length > 0,
            snapshotLen: (snapshot || "").length,
            finalLen: v.length,
            inputFound: cur.ok,
            inputKind: cur.kind,
            preview: v
          });
          resolve({ ok: false, text: v, kind: cur.kind, inputOk: cur.ok });
          return;
        }

        setTimeout(tick, 60);
      };

      tick();
    });
  }

  function ensureNotGenerating(timeoutMs) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        if (!findStopGeneratingButton()) {
          resolve(true);
          return;
        }
        if (performance.now() - t0 > timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(tick, 120);
      };
      tick();
    });
  }

  async function clickSendWithAck() {
    const before = readInputText().text;

    const btn = findSendButton();
    if (!btn) {
      tmLog("SEND", "send button not found");
      return false;
    }
    if (isDisabled(btn)) {
      tmLog("SEND", "send button disabled", { btn: describeEl(btn) });
      return false;
    }

    humanClick(btn, "send");

    const t0 = performance.now();
    while (performance.now() - t0 <= CFG.sendAckTimeoutMs) {
      const cur = readInputText().text;
      const cleared = cur.trim().length === 0;
      const stopGen = findStopGeneratingButton();
      const ack = cleared || !!stopGen;

      if (ack) {
        tmLog("SEND", "ack ok", { ok: true, changed: cur !== before, len: cur.length, preview: cur });
        return true;
      }

      await new Promise((r) => setTimeout(r, 120));
    }

    const cur = readInputText().text;
    tmLog("SEND", "ack timeout", { ok: false, changed: cur !== before, len: cur.length, preview: cur });
    return false;
  }

  let inFlight = false;

  async function runFlowAfterSubmitClick(submitBtnDesc, clickHeld) {
    if (inFlight) {
      tmLog("FLOW", "skip: inFlight already true");
      return;
    }
    inFlight = true;

    try {
      const snap = readInputText();
      const snapshot = snap.text;

      graceUntilMs = performance.now() + CFG.modifierGraceMs;
      graceCaptured = false;
      const initialHeld = isModifierHeldNow();

      tmLog("FLOW", "submit click flow start", {
        btn: submitBtnDesc,
        inputFound: snap.ok,
        inputKind: snap.kind,
        snapshotLen: snapshot.length,
        snapshot,
        graceMs: CFG.modifierGraceMs
      });

      const finalRes = await waitForFinalText({
        snapshot,
        timeoutMs: CFG.finalTextTimeoutMs,
        quietMs: CFG.finalTextQuietMs
      });

      const heldDuring = initialHeld || graceCaptured || isModifierHeldNow() || clickHeld;

      const shouldSend = CFG.holdToSend ? heldDuring : !heldDuring;

      tmLog("FLOW", "decision", { heldDuring, holdToSend: CFG.holdToSend, shouldSend });

      if (!finalRes.ok) {
        tmLog("FLOW", "no stable final text, abort");
        return;
      }

      if ((finalRes.text || "").trim().length === 0) {
        tmLog("FLOW", "final text empty, abort");
        return;
      }

      if (!shouldSend) {
        tmLog("FLOW", "send skipped by modifier");
        return;
      }

      const okGen = await ensureNotGenerating(20000);
      if (!okGen) {
        tmLog("FLOW", "abort: still generating");
        return;
      }

      const ok1 = await clickSendWithAck();
      tmLog("FLOW", "send result", { ok: ok1 });

      if (!ok1) {
        const ok2 = await clickSendWithAck();
        tmLog("FLOW", "send retry result", { ok: ok2 });
      }
    } catch (e) {
      tmLog("ERR", "flow exception", { preview: String(e && (e.stack || e.message || e)) });
    } finally {
      inFlight = false;
      tmLog("FLOW", "submit click flow end");
    }
  }

  function isInterestingButton(btn) {
    if (!btn) return false;
    const a = norm(btn.getAttribute("aria-label"));
    const t = norm(btn.getAttribute("title"));
    const dt = norm(btn.getAttribute("data-testid"));
    if (dt.includes("send") || dt.includes("stop") || dt.includes("voice") || dt.includes("dict")) return true;
    if (a.includes("send") || a.includes("stop") || a.includes("dictat") || a.includes("voice")) return true;
    if (a.includes("отправ") || a.includes("останов") || a.includes("диктов") || a.includes("микроф")) return true;
    if (t.includes("send") || t.includes("stop") || t.includes("voice") || t.includes("dict")) return true;
    return false;
  }

  function getStorageArea(preferSync) {
    const api = typeof browser !== "undefined" ? browser : chrome;
    const storage = api && api.storage ? api.storage : null;
    if (!storage) return null;
    if (preferSync && storage.sync) return storage.sync;
    if (storage.local) return storage.local;
    return null;
  }

  function storageGet(defaults, cb) {
    const areaSync = getStorageArea(true);
    const areaLocal = getStorageArea(false);
    const done = (res) => cb(res || defaults);

    if (areaSync && typeof areaSync.get === "function") {
      try {
        areaSync.get(defaults, (res) => {
          const err = chrome && chrome.runtime ? chrome.runtime.lastError : null;
          if (!err) return done(res);
          if (!areaLocal) return done(defaults);
          try {
            areaLocal.get(defaults, (res2) => done(res2));
          } catch (_) {
            done(defaults);
          }
        });
        return;
      } catch (_) {
      }
    }

    if (areaLocal && typeof areaLocal.get === "function") {
      try {
        areaLocal.get(defaults, (res) => done(res));
        return;
      } catch (_) {
      }
    }

    done(defaults);
  }

  function storageSet(values, cb) {
    const areaSync = getStorageArea(true);
    const areaLocal = getStorageArea(false);
    const done = () => {
      if (typeof cb === "function") cb();
    };

    if (areaSync && typeof areaSync.set === "function") {
      try {
        areaSync.set(values, () => {
          const err = chrome && chrome.runtime ? chrome.runtime.lastError : null;
          if (!err) return done();
          if (!areaLocal || typeof areaLocal.set !== "function") return done();
          try {
            areaLocal.set(values, () => done());
          } catch (_) {
            done();
          }
        });
        return;
      } catch (_) {
      }
    }

    if (areaLocal && typeof areaLocal.set === "function") {
      try {
        areaLocal.set(values, () => done());
        return;
      } catch (_) {
      }
    }

    done();
  }

  function refreshSettings() {
    storageGet(
      { skipKey: "Shift", holdToSend: false, autoExpandChats: true, autoTempChat: false, tempChatEnabled: false },
      (res) => {
      if (res && typeof res.skipKey === "string") CFG.modifierKey = res.skipKey;
      if (CFG.modifierKey === "None") CFG.modifierKey = null;
      CFG.holdToSend = !!(res && res.holdToSend);
      CFG.autoExpandChatsEnabled = res && "autoExpandChats" in res ? !!res.autoExpandChats : true;
      CFG.autoTempChatEnabled = res && "autoTempChat" in res ? !!res.autoTempChat : false;
      tempChatEnabled = res && "tempChatEnabled" in res ? !!res.tempChatEnabled : false;
      log("settings refreshed", {
        skipKey: CFG.modifierKey,
        holdToSend: CFG.holdToSend,
        autoExpandChats: CFG.autoExpandChatsEnabled,
        autoTempChat: CFG.autoTempChatEnabled,
        tempChatEnabled
      });
      maybeEnableTempChat();
    }
    );
  }

  let graceUntilMs = 0;
  let graceCaptured = false;

  const TEMP_CHAT_ON_SELECTOR = 'button[aria-label="Turn on temporary chat"]';
  const TEMP_CHAT_OFF_SELECTOR = 'button[aria-label="Turn off temporary chat"]';
  const TEMP_CHAT_MAX_RETRIES = 5;
  const TEMP_CHAT_RETRY_MS = 300;
  const tempChatState = {
    retries: 0,
    started: false,
    observer: null,
    urlIntervalId: null,
    lastPath: ""
  };

  function isTempChatActive() {
    return !!qs(TEMP_CHAT_OFF_SELECTOR);
  }

  function findVisibleBySelector(sel) {
    return qsa(sel).find((el) => isElementVisible(el) && !el.disabled);
  }

  function persistTempChatEnabled(value) {
    tempChatEnabled = value;
    storageSet({ tempChatEnabled });
    tmLog("TEMPCHAT", "persist state", { ok: value });
  }

  function maybeEnableTempChat() {
    if (!CFG.autoTempChatEnabled || !tempChatEnabled || isTempChatActive()) {
      tempChatState.retries = 0;
      return;
    }

    const btn = findVisibleBySelector(TEMP_CHAT_ON_SELECTOR);
    if (!btn) return;

    humanClick(btn, "tempchat-enable");
    tmLog("TEMPCHAT", "auto-clicked on");

    setTimeout(() => {
      if (isTempChatActive()) {
        tmLog("TEMPCHAT", "enabled");
        tempChatState.retries = 0;
      } else if (++tempChatState.retries <= TEMP_CHAT_MAX_RETRIES) {
        tmLog("TEMPCHAT", `retry ${tempChatState.retries}`);
        maybeEnableTempChat();
      } else {
        tmLog("TEMPCHAT", "failed after retries");
        tempChatState.retries = 0;
      }
    }, TEMP_CHAT_RETRY_MS);
  }

  function handleTempChatManualToggle(e) {
    if (!e.isTrusted) return;
    const target = e.target;
    if (!target || !target.closest) return;
    if (target.closest(TEMP_CHAT_ON_SELECTOR)) return persistTempChatEnabled(true);
    if (target.closest(TEMP_CHAT_OFF_SELECTOR)) return persistTempChatEnabled(false);
  }

  function startAutoTempChat() {
    if (tempChatState.started) return;
    tempChatState.started = true;
    tempChatState.lastPath = location.pathname + location.search;

    document.addEventListener("click", handleTempChatManualToggle, true);

    tempChatState.observer = new MutationObserver(() => maybeEnableTempChat());
    tempChatState.observer.observe(document.documentElement, { childList: true, subtree: true });

    tempChatState.urlIntervalId = setInterval(() => {
      const cur = location.pathname + location.search;
      if (cur !== tempChatState.lastPath) {
        tempChatState.lastPath = cur;
        tempChatState.retries = 0;
        maybeEnableTempChat();
      }
    }, 100);

    maybeEnableTempChat();
  }

  refreshSettings();

  const storageApi = (typeof browser !== "undefined" ? browser : chrome)?.storage;
  if (storageApi && storageApi.onChanged && typeof storageApi.onChanged.addListener === "function") {
    storageApi.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync" && areaName !== "local") return;
      if (
        !changes ||
        (!("autoExpandChats" in changes) &&
          !("skipKey" in changes) &&
          !("holdToSend" in changes) &&
          !("autoTempChat" in changes) &&
          !("tempChatEnabled" in changes))
      ) {
        return;
      }
      refreshSettings();
    });
  }

  const AUTO_EXPAND_LOOP_MS = 400;
  const AUTO_EXPAND_CLICK_COOLDOWN_MS = 1500;
  const autoExpandState = {
    running: false,
    started: false,
    lastClickAtByKey: new Map(),
    intervalId: null,
    observer: null
  };

  function autoExpandCanClick(key) {
    const t = autoExpandState.lastClickAtByKey.get(key) || 0;
    return Date.now() - t > AUTO_EXPAND_CLICK_COOLDOWN_MS;
  }

  function autoExpandMarkClick(key) {
    autoExpandState.lastClickAtByKey.set(key, Date.now());
  }

  function autoExpandDispatchClick(el) {
    const seq = ["pointerdown", "mousedown", "mouseup", "click"];
    for (const t of seq) {
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    }
  }

  function autoExpandClickIfPossible(key, el, reason) {
    if (!el) return false;
    if (!isElementVisible(el)) return false;
    if (!autoExpandCanClick(key)) return false;
    autoExpandMarkClick(key);
    tmLog("AUTOEXPAND", `click ${key}`, { preview: reason });
    autoExpandDispatchClick(el);
    return true;
  }

  function autoExpandSidebarEl() {
    return qs("#stage-slideover-sidebar");
  }

  function autoExpandSidebarIsOpen() {
    const sb = autoExpandSidebarEl();
    if (!sb) return false;
    if (!isElementVisible(sb)) return false;
    return sb.getBoundingClientRect().width >= 120;
  }

  function autoExpandOpenSidebarButton() {
    return (
      qs('#stage-sidebar-tiny-bar button[aria-label="Open sidebar"][aria-controls="stage-slideover-sidebar"]') ||
      qs('button[aria-label="Open sidebar"][aria-controls="stage-slideover-sidebar"]')
    );
  }

  function autoExpandEnsureSidebarOpen() {
    if (autoExpandSidebarIsOpen()) return false;
    const btn = autoExpandOpenSidebarButton();
    return autoExpandClickIfPossible("openSidebar", btn, "sidebar closed by geometry");
  }

  function autoExpandChatHistoryNav() {
    const sb = autoExpandSidebarEl();
    if (!sb) return null;
    return sb.querySelector('nav[aria-label="Chat history"]');
  }

  function autoExpandFindYourChatsSection(nav) {
    if (!nav) return null;

    const sections = Array.from(nav.querySelectorAll("div.group\\/sidebar-expando-section"));
    for (const sec of sections) {
      const t = norm(sec.textContent);
      if (t.includes("your chats") || t.includes("your charts") || t.includes("чаты") || t.includes("история")) {
        return sec;
      }
    }

    if (sections.length >= 4) return sections[3];
    return null;
  }

  function autoExpandSectionCollapsed(sec) {
    const cls = String(sec.className || "");
    if (cls.includes("sidebar-collapsed-section-margin-bottom")) return true;
    if (cls.includes("sidebar-expanded-section-margin-bottom")) return false;

    if (cls.includes("--sidebar-collapsed-section-margin-bottom")) return true;
    if (cls.includes("--sidebar-expanded-section-margin-bottom")) return false;

    return false;
  }

  function autoExpandExpandYourChats() {
    if (!autoExpandSidebarIsOpen()) return false;

    const nav = autoExpandChatHistoryNav();
    if (!nav || !isElementVisible(nav)) return false;

    const sec = autoExpandFindYourChatsSection(nav);
    if (!sec) return false;

    if (!autoExpandSectionCollapsed(sec)) return false;

    const btn = sec.querySelector("button.text-token-text-tertiary.flex.w-full") ||
      sec.querySelector("button") ||
      sec.querySelector('[role="button"]');

    return autoExpandClickIfPossible("expandYourChats", btn, "section looks collapsed");
  }

  function autoExpandTick() {
    if (!CFG.autoExpandChatsEnabled) return;
    if (autoExpandState.running) return;
    autoExpandState.running = true;
    try {
      autoExpandEnsureSidebarOpen();
      autoExpandExpandYourChats();
    } catch (e) {
      tmLog("AUTOEXPAND", "tick error", { preview: String(e && (e.stack || e.message || e)) });
    } finally {
      autoExpandState.running = false;
    }
  }

  function startAutoExpand() {
    if (autoExpandState.started) return;
    autoExpandState.started = true;
    autoExpandTick();

    autoExpandState.intervalId = setInterval(autoExpandTick, AUTO_EXPAND_LOOP_MS);

    autoExpandState.observer = new MutationObserver(() => autoExpandTick());
    autoExpandState.observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        startAutoExpand();
        startAutoTempChat();
      },
      { once: true }
    );
  } else {
    startAutoExpand();
    startAutoTempChat();
  }

  document.addEventListener(
    "click",
    (e) => {
      const target = e.target;
      const btn = target && target.closest ? target.closest("button") : null;
      if (!btn) return;

      const btnDesc = describeEl(btn);

      if (CFG.logClicks && isInterestingButton(btn)) {
        const cur = readInputText();
        tmLog("CLICK", "button click", {
          btn: btnDesc,
          inputFound: cur.ok,
          inputKind: cur.kind,
          len: cur.text.length,
          preview: cur.text,
          graceActive: performance.now() <= graceUntilMs
        });
      }

      if (CFG.enabled && isSubmitDictationButton(btn)) {
        refreshSettings();
        runFlowAfterSubmitClick(btnDesc, isModifierHeldFromEvent(e));
      }
    },
    true
  );

  tmLog("BOOT", "content script loaded", { preview: location.href });
})();
