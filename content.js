(() => {
  "use strict";

  if (window.__ChatGPTDictationAutoSendLoaded__) return;
  window.__ChatGPTDictationAutoSendLoaded__ = true;

  const DEBUG = false;
  const log = (...args) => {
    if (DEBUG) console.info("[DictationAutoSend]", ...args);
  };

  // Settings
  // skipKey: Shift | Control | Alt | None
  // holdToSend: boolean
  let skipKey = "Shift";
  let holdToSend = false;

  // Modifier key state
  const keyState = { shift: false, ctrl: false, alt: false };

  function updateKeyState(e, state) {
    if (e.key === "Shift") keyState.shift = state;
    if (e.key === "Control" || e.key === "Ctrl") keyState.ctrl = state;
    if (e.key === "Alt") keyState.alt = state;
  }

  window.addEventListener("keydown", (e) => updateKeyState(e, true), true);
  window.addEventListener("keyup", (e) => updateKeyState(e, false), true);
  window.addEventListener(
    "blur",
    () => {
      keyState.shift = false;
      keyState.ctrl = false;
      keyState.alt = false;
    },
    true
  );

  function isModifierHeld(ev, key) {
    if (!key || key === "None") return false;
    if (key === "Shift") return !!ev.shiftKey || keyState.shift;
    if (key === "Control") return !!ev.ctrlKey || keyState.ctrl;
    if (key === "Alt") return !!ev.altKey || keyState.alt;
    return false;
  }

  function isModifierHeldNow(key) {
    if (!key || key === "None") return false;
    if (key === "Shift") return keyState.shift;
    if (key === "Control") return keyState.ctrl;
    if (key === "Alt") return keyState.alt;
    return false;
  }

  // Storage helpers: sync -> local fallback, callback-first (Firefox friendly)
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
      } catch (_) { }
    }

    if (areaLocal && typeof areaLocal.get === "function") {
      try {
        areaLocal.get(defaults, (res) => done(res));
        return;
      } catch (_) { }
    }

    done(defaults);
  }

  function refreshSettings() {
    storageGet({ skipKey: "Shift", holdToSend: false }, (res) => {
      if (res && typeof res.skipKey === "string") skipKey = res.skipKey;
      holdToSend = !!(res && res.holdToSend);
      log("settings refreshed", { skipKey, holdToSend });
    });
  }

  refreshSettings();

  // Selectors
  const acceptSelectors = [
    'button[aria-label*="Submit dictation"]',
    'button[aria-label*="Dictation submit"]',
    'button[aria-label*="Accept dictation"]',
    'button[aria-label*="Confirm dictation"]',
    'button[aria-label*="Готово"]',
    'button[aria-label*="Подтверд"]',
    'button[aria-label*="Принять"]'
  ].join(",");

  const dictateStartSelectors = [
    'button[aria-label="Dictate button"]',
    'button[aria-label*="Dictate"]',
    'button[aria-label*="Диктов"]'
  ].join(",");

  const micStopSelectors = [
    'button[aria-label="Stop recording"]',
    'button[aria-label="Стоп запись"]',
    '[aria-label*="Stop dictat"]',
    '[aria-label*="Stop recording"]'
  ].join(",");

  function findTextbox() {
    return (
      document.querySelector('textarea[data-testid="textbox"]') ||
      document.querySelector("textarea#prompt-textarea") ||
      document.querySelector("#prompt-textarea") ||
      document.querySelector("textarea[placeholder]") ||
      document.querySelector('div[contenteditable="true"][role="textbox"]') ||
      document.querySelector('[role="textbox"][contenteditable="true"]') ||
      null
    );
  }

  function readTextboxText(el) {
    if (!el) return "";
    if (el.tagName === "TEXTAREA") return el.value || "";
    return (el.innerText || el.textContent || "").replace(/\u00A0/g, " ");
  }

  function findActionButton() {
    // During generation this often becomes Stop, otherwise Send.
    return (
      document.querySelector('[data-testid="send-button"]') ||
      document.querySelector("#composer-submit-button") ||
      document.querySelector('form button[type="submit"]') ||
      document.querySelector('button[aria-label*="Send"]') ||
      document.querySelector('button[aria-label*="Отправ"]') ||
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

  function isStopButton(btn) {
    if (!btn) return false;
    const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
    const testid = (btn.getAttribute("data-testid") || "").toLowerCase();
    const id = (btn.id || "").toLowerCase();
    const cls = (btn.className || "").toString().toLowerCase();

    if (aria.includes("stop")) return true;
    if (aria.includes("останов")) return true;
    if (testid.includes("stop")) return true;
    if (id.includes("stop")) return true;
    if (cls.includes("stop")) return true;

    return false;
  }

  async function waitForSendButton(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const btn = findActionButton();
      if (btn && !isDisabled(btn) && !isStopButton(btn)) return btn;
      await new Promise((r) => setTimeout(r, 120));
    }
    return null;
  }

  function humanClick(el) {
    if (!el) return false;

    try {
      if (typeof el.focus === "function") el.focus();
    } catch (_) { }

    const rect = el.getBoundingClientRect();
    const cx = Math.max(1, Math.floor(rect.left + rect.width / 2));
    const cy = Math.max(1, Math.floor(rect.top + rect.height / 2));
    const common = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0 };

    try {
      el.dispatchEvent(new PointerEvent("pointerdown", { ...common, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    } catch (_) { }
    try {
      el.dispatchEvent(new MouseEvent("mousedown", common));
    } catch (_) { }
    try {
      el.dispatchEvent(new PointerEvent("pointerup", { ...common, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    } catch (_) { }
    try {
      el.dispatchEvent(new MouseEvent("mouseup", common));
    } catch (_) { }
    try {
      el.dispatchEvent(new MouseEvent("click", common));
    } catch (_) { }

    return true;
  }

  function waitForFinalText(snapshotText, timeoutMs, quietMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const snap = snapshotText || "";
      let lastText = null;
      let lastChangeAt = Date.now();

      const want = (t) => {
        const cur = t || "";
        if (snap.length === 0) return cur.trim().length > 0;
        return cur !== snap;
      };

      const tick = () => {
        const tb = findTextbox();
        const nowText = readTextboxText(tb);

        if (lastText === null) {
          lastText = nowText;
          lastChangeAt = Date.now();
        } else if (nowText !== lastText) {
          lastText = nowText;
          lastChangeAt = Date.now();
        }

        const stable = Date.now() - lastChangeAt >= quietMs;

        if (tb && stable && want(lastText)) {
          cleanup();
          resolve({ ok: true, text: lastText });
          return;
        }

        if (Date.now() - start >= timeoutMs) {
          cleanup();
          resolve({ ok: false, text: lastText });
        }
      };

      const timer = setInterval(tick, 80);
      const cleanup = () => clearInterval(timer);
      tick();
    });
  }

  // Dictation state
  let snapshotAtRecordStart = "";
  let isRecording = false;
  let sending = false;

  window.addEventListener(
    "click",
    (ev) => {
      const path = ev.composedPath ? ev.composedPath() : [ev.target];
      const btn = path.find((n) => n && n.nodeType === 1 && n.tagName === "BUTTON");
      if (!btn) return;
      if (btn.matches(dictateStartSelectors) && !btn.matches(acceptSelectors)) {
        const tb = findTextbox();
        snapshotAtRecordStart = readTextboxText(tb);
        isRecording = true;
        log("dictate start", snapshotAtRecordStart.length);
      }
    },
    true
  );

  const recObserver = new MutationObserver(() => {
    const nowRecording = !!document.querySelector(micStopSelectors);
    if (!nowRecording && isRecording) {
      isRecording = false;
      log("recording end");
    }
  });

  recObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["aria-label"]
  });

  // Main handler
  window.addEventListener(
    "click",
    (ev) => {
      if (sending) return;

      const path = ev.composedPath ? ev.composedPath() : [ev.target];
      const btn = path.find((n) => n && n.nodeType === 1 && n.tagName === "BUTTON");
      if (!btn) return;
      if (!btn.matches(acceptSelectors)) return;

      refreshSettings();

      sending = true;
      const snapshot = snapshotAtRecordStart;
      log("accept click; snapshot length", snapshot.length);

      setTimeout(async () => {
        let modifierHeldDuring = isModifierHeld(ev, skipKey);
        const modifierTracker = setInterval(() => {
          if (isModifierHeldNow(skipKey)) modifierHeldDuring = true;
        }, 80);

        const res = await waitForFinalText(snapshot, 25000, 320);
        clearInterval(modifierTracker);
        if (!res.ok) {
          log("timeout waiting for transcription");
          sending = false;
          return;
        }

        await new Promise((r) => setTimeout(r, 120));

        if (isModifierHeldNow(skipKey)) modifierHeldDuring = true;
        const shouldSend = holdToSend ? modifierHeldDuring : !modifierHeldDuring;
        if (!shouldSend) {
          log("accept click: skip auto send", {
            heldDuring: modifierHeldDuring,
            holdToSend,
            skipKey
          });
          sending = false;
          return;
        }

        // If ChatGPT is generating, the action button is Stop.
        // Behavior: stop generation first, then wait for Send and send the new prompt.
        let actionBtn = findActionButton();
        log("action button", {
          found: !!actionBtn,
          disabled: actionBtn ? isDisabled(actionBtn) : null,
          aria: actionBtn ? actionBtn.getAttribute("aria-label") : null,
          isStop: actionBtn ? isStopButton(actionBtn) : null
        });

        if (actionBtn && !isDisabled(actionBtn) && isStopButton(actionBtn)) {
          humanClick(actionBtn);
          // Give UI a moment to switch from Stop to Send.
          await new Promise((r) => setTimeout(r, 200));
        }

        let sendBtn = findActionButton();
        if (!sendBtn || isDisabled(sendBtn) || isStopButton(sendBtn)) {
          sendBtn = await waitForSendButton(15000);
        }

        if (!sendBtn) {
          sending = false;
          return;
        }

        humanClick(sendBtn);
        log("auto sent");
        sending = false;
      }, 30);
    },
    true
  );

  log("dictation auto-send content script loaded");
})();
