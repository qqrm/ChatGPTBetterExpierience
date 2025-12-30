import { decideAutoSend } from "./autoSendUseCases";
import { DictationConfig, DictationInputKind } from "../domain/dictation";
import { SETTINGS_DEFAULTS } from "../domain/settings";
import { StorageApi, storageGet, storageSet } from "../lib/storage";
import { isElementVisible, isVisible, norm, normalizeSettings } from "../lib/utils";

declare global {
  interface Window {
    __ChatGPTDictationAutoSendLoaded__?: boolean;
  }
}

export interface ContentScriptDeps {
  storageApi?: StorageApi | null;
  lastError?: () => unknown;
}

export const startContentScript = ({ storageApi, lastError }: ContentScriptDeps = {}) => {
  if (window.__ChatGPTDictationAutoSendLoaded__) return;
  window.__ChatGPTDictationAutoSendLoaded__ = true;

  const DEBUG = false;
  const log = (...args: unknown[]) => {
    if (DEBUG) console.info("[DictationAutoSend]", ...args);
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitPresent(sel: string, root: Document | Element = document, timeoutMs = 2500) {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      const el = root.querySelector(sel);
      if (el) return el;
      await sleep(25);
    }
    return null;
  }

  interface ContentConfig extends DictationConfig {
    autoExpandChatsEnabled: boolean;
    autoTempChatEnabled: boolean;
    oneClickDeleteEnabled: boolean;
    logClicks: boolean;
    logBlur: boolean;
  }

  const CFG: ContentConfig = {
    enabled: true,

    holdToSend: false,
    modifierKey: "Shift",
    modifierGraceMs: 1600,

    autoExpandChatsEnabled: true,
    autoTempChatEnabled: false,
    oneClickDeleteEnabled: false,

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

  function short(s: string, n = 140) {
    if (s == null) return "";
    const t = String(s).replace(/\s+/g, " ").trim();
    if (t.length <= n) return t;
    return t.slice(0, n) + "...";
  }

  type LogFields = Record<string, unknown> & {
    preview?: string;
    snapshot?: string;
    btn?: string;
  };

  function tmLog(scope: string, msg: string, fields?: LogFields) {
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
      const parts: string[] = [];
      for (const k of allow) {
        if (k in fields) parts.push(`${k}=${String(fields[k])}`);
      }
      if ("preview" in fields) parts.push(`preview="${short(String(fields.preview ?? ""), 120)}"`);
      if ("snapshot" in fields)
        parts.push(`snapshot="${short(String(fields.snapshot ?? ""), 120)}"`);
      if ("btn" in fields) parts.push(`btn="${short(String(fields.btn ?? ""), 160)}"`);
      if (parts.length) tail = " | " + parts.join(" ");
    }
    console.log(`[TM DictationAutoSend] #${LOG_N} ${t} ${scope}: ${msg}${tail}`);
  }

  function qs<T extends Element = Element>(sel: string, root: Document | Element = document) {
    return root.querySelector<T>(sel);
  }

  function qsa<T extends Element = Element>(sel: string, root: Document | Element = document) {
    return Array.from(root.querySelectorAll<T>(sel));
  }

  function describeEl(el: Element | null) {
    if (!el) return "null";
    const tag = el.tagName ? el.tagName.toLowerCase() : "node";
    const id = (el as HTMLElement).id ? `#${(el as HTMLElement).id}` : "";
    const dt = el.getAttribute ? el.getAttribute("data-testid") : "";
    const aria = el.getAttribute ? el.getAttribute("aria-label") : "";
    const title = el.getAttribute ? el.getAttribute("title") : "";
    const txt = el.textContent ? short(el.textContent, 60) : "";
    const bits: string[] = [];
    bits.push(`${tag}${id}`);
    if (dt) bits.push(`data-testid=${dt}`);
    if (aria) bits.push(`aria="${short(aria, 60)}"`);
    if (title) bits.push(`title="${short(title, 60)}"`);
    if (txt) bits.push(`text="${txt}"`);
    return bits.join(" ");
  }

  function humanClick(el: HTMLElement | null, why: string) {
    if (!el) return false;
    try {
      if (typeof el.focus === "function") el.focus();
    } catch (_) {}

    try {
      el.scrollIntoView({ block: "center", inline: "center" });
    } catch (_) {}

    const rect = el.getBoundingClientRect();
    const cx = Math.max(1, Math.floor(rect.left + rect.width / 2));
    const cy = Math.max(1, Math.floor(rect.top + rect.height / 2));
    const common = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: cx,
      clientY: cy,
      button: 0
    };

    try {
      el.dispatchEvent(
        new PointerEvent("pointerdown", {
          ...common,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true
        })
      );
    } catch (_) {}
    try {
      el.dispatchEvent(new MouseEvent("mousedown", common));
    } catch (_) {}
    try {
      el.dispatchEvent(
        new PointerEvent("pointerup", {
          ...common,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true
        })
      );
    } catch (_) {}
    try {
      el.dispatchEvent(new MouseEvent("mouseup", common));
    } catch (_) {}
    try {
      el.dispatchEvent(new MouseEvent("click", common));
    } catch (_) {}

    tmLog("UI", `humanClick ${why}`, { preview: describeEl(el) });
    return true;
  }

  type TextboxElement = HTMLTextAreaElement | HTMLElement;

  function findTextbox(): TextboxElement | null {
    return (
      qs<HTMLTextAreaElement>('textarea[data-testid="textbox"]') ||
      qs<HTMLTextAreaElement>("textarea#prompt-textarea") ||
      qs<HTMLTextAreaElement>("#prompt-textarea") ||
      qs<HTMLTextAreaElement>("textarea[data-testid='prompt-textarea']") ||
      qs<HTMLTextAreaElement>("textarea[placeholder]") ||
      qs<HTMLElement>('div[contenteditable="true"][role="textbox"]') ||
      qs<HTMLElement>('[role="textbox"][contenteditable="true"]') ||
      null
    );
  }

  function readTextboxText(el: TextboxElement | null) {
    if (!el) return "";
    if (el instanceof HTMLTextAreaElement) return el.value || "";
    return String(el.innerText || el.textContent || "").replace(/\u00A0/g, " ");
  }

  interface InputReadResult {
    ok: boolean;
    kind: DictationInputKind;
    text: string;
  }

  function readInputText(): InputReadResult {
    const el = findTextbox();
    if (!el) return { ok: false, kind: "none", text: "" };
    const kind: DictationInputKind =
      el instanceof HTMLTextAreaElement ? "textarea" : "contenteditable";
    return { ok: true, kind, text: readTextboxText(el) };
  }

  function findSendButton(): HTMLButtonElement | null {
    return (
      qs<HTMLButtonElement>('[data-testid="send-button"]') ||
      qs<HTMLButtonElement>("#composer-submit-button") ||
      qs<HTMLButtonElement>("form button[type='submit']") ||
      qs<HTMLButtonElement>('button[aria-label*="Send"]') ||
      qs<HTMLButtonElement>('button[aria-label*="Отправ"]') ||
      null
    );
  }

  function isDisabled(btn: HTMLButtonElement | null) {
    if (!btn) return true;
    if (btn.hasAttribute("disabled")) return true;
    const ariaDisabled = btn.getAttribute("aria-disabled");
    if (ariaDisabled && ariaDisabled !== "false") return true;
    return false;
  }

  function isSubmitDictationButton(btn: HTMLButtonElement | null) {
    if (!btn) return false;
    const a = norm(btn.getAttribute("aria-label"));
    const t = norm(btn.getAttribute("title"));
    const dt = norm(btn.getAttribute("data-testid"));
    const txt = norm(btn.textContent);

    if (a.includes("submit dictation")) return true;
    if (
      a.includes("dictation") &&
      (a.includes("submit") || a.includes("accept") || a.includes("confirm"))
    )
      return true;

    if (a.includes("готово")) return true;
    if (a.includes("подтверд")) return true;
    if (a.includes("принять")) return true;

    if (
      dt.includes("dictation") &&
      (dt.includes("submit") || dt.includes("done") || dt.includes("finish"))
    )
      return true;

    if (t.includes("submit dictation")) return true;
    if (txt.includes("submit dictation")) return true;

    return false;
  }

  function findStopGeneratingButton() {
    const candidates = qsa<HTMLButtonElement>("button").filter((b) => {
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

  function keyMatchesModifier(e: KeyboardEvent | null) {
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

  function isModifierHeldFromEvent(e: MouseEvent | null) {
    if (!CFG.modifierKey || CFG.modifierKey === "None") return false;
    if (!e) return false;
    if (CFG.modifierKey === "Control") return !!e.ctrlKey;
    if (CFG.modifierKey === "Alt") return !!e.altKey;
    return !!e.shiftKey;
  }

  const keyState = { shift: false, ctrl: false, alt: false };
  let tempChatEnabled = false;

  function updateKeyState(e: KeyboardEvent, state: boolean) {
    if (e.key === "Shift") keyState.shift = state;
    if (e.key === "Control" || e.key === "Ctrl") keyState.ctrl = state;
    if (e.key === "Alt") keyState.alt = state;
  }

  window.addEventListener(
    "keydown",
    (e: KeyboardEvent) => {
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
    (e: KeyboardEvent) => {
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

  interface WaitForFinalTextArgs {
    snapshot: string;
    timeoutMs: number;
    quietMs: number;
  }

  interface WaitForFinalTextResult extends InputReadResult {
    ok: boolean;
    inputOk: boolean;
  }

  function waitForFinalText({ snapshot, timeoutMs, quietMs }: WaitForFinalTextArgs) {
    return new Promise<WaitForFinalTextResult>((resolve) => {
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
          tmLog("WAIT", "input changed", {
            inputFound: cur.ok,
            inputKind: cur.kind,
            len: v.length,
            preview: v
          });
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

  function ensureNotGenerating(timeoutMs: number) {
    return new Promise<boolean>((resolve) => {
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

  async function stopGeneratingIfPossible(timeoutMs: number) {
    const stopBtn = findStopGeneratingButton();
    if (!stopBtn) return true;

    tmLog("SEND", "stop generating before send", { btn: describeEl(stopBtn) });
    humanClick(stopBtn, "stop generating");

    const ok = await ensureNotGenerating(timeoutMs);
    if (!ok) {
      tmLog("SEND", "stop generating timeout");
    }
    return ok;
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
        tmLog("SEND", "ack ok", {
          ok: true,
          changed: cur !== before,
          len: cur.length,
          preview: cur
        });
        return true;
      }

      await new Promise((r) => setTimeout(r, 120));
    }

    const cur = readInputText().text;
    tmLog("SEND", "ack timeout", {
      ok: false,
      changed: cur !== before,
      len: cur.length,
      preview: cur
    });
    return false;
  }

  let inFlight = false;

  async function runFlowAfterSubmitClick(submitBtnDesc: string, clickHeld: boolean) {
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

      const decision = decideAutoSend({ holdToSend: CFG.holdToSend, heldDuring });

      tmLog("FLOW", "decision", {
        heldDuring: decision.heldDuring,
        holdToSend: decision.holdToSend,
        shouldSend: decision.shouldSend
      });

      if (!finalRes.ok) {
        tmLog("FLOW", "no stable final text, abort");
        return;
      }

      if ((finalRes.text || "").trim().length === 0) {
        tmLog("FLOW", "final text empty, abort");
        return;
      }

      if (!decision.shouldSend) {
        tmLog("FLOW", "send skipped by modifier");
        return;
      }

      const okGen = await stopGeneratingIfPossible(20000);
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
      tmLog("ERR", "flow exception", {
        preview: String((e && (e as Error).stack) || (e as Error).message || e)
      });
    } finally {
      inFlight = false;
      tmLog("FLOW", "submit click flow end");
    }
  }

  function isInterestingButton(btn: HTMLButtonElement | null) {
    if (!btn) return false;
    const a = norm(btn.getAttribute("aria-label"));
    const t = norm(btn.getAttribute("title"));
    const dt = norm(btn.getAttribute("data-testid"));
    if (dt.includes("send") || dt.includes("stop") || dt.includes("voice") || dt.includes("dict"))
      return true;
    if (a.includes("send") || a.includes("stop") || a.includes("dictat") || a.includes("voice"))
      return true;
    if (
      a.includes("отправ") ||
      a.includes("останов") ||
      a.includes("диктов") ||
      a.includes("микроф")
    )
      return true;
    if (t.includes("send") || t.includes("stop") || t.includes("voice") || t.includes("dict"))
      return true;
    return false;
  }

  const resolvedLastError = lastError ?? (() => null);

  async function refreshSettings() {
    const res = await storageGet(SETTINGS_DEFAULTS, storageApi, resolvedLastError);
    const settings = normalizeSettings(res);
    CFG.modifierKey = settings.skipKey;
    if (CFG.modifierKey === "None") CFG.modifierKey = null;
    CFG.holdToSend = settings.holdToSend;
    CFG.autoExpandChatsEnabled = settings.autoExpandChats;
    CFG.autoTempChatEnabled = settings.autoTempChat;
    CFG.oneClickDeleteEnabled = settings.oneClickDelete;
    tempChatEnabled = settings.tempChatEnabled;
    log("settings refreshed", {
      skipKey: CFG.modifierKey,
      holdToSend: CFG.holdToSend,
      autoExpandChats: CFG.autoExpandChatsEnabled,
      autoTempChat: CFG.autoTempChatEnabled,
      oneClickDelete: CFG.oneClickDeleteEnabled,
      tempChatEnabled
    });
    maybeEnableTempChat();
    updateOneClickDeleteState();
  }

  let graceUntilMs = 0;
  let graceCaptured = false;

  const TEMP_CHAT_ON_SELECTOR = 'button[aria-label="Turn on temporary chat"]';
  const TEMP_CHAT_OFF_SELECTOR = 'button[aria-label="Turn off temporary chat"]';
  const TEMP_CHAT_MAX_RETRIES = 5;
  const TEMP_CHAT_RETRY_MS = 300;
  const tempChatState: {
    retries: number;
    started: boolean;
    observer: MutationObserver | null;
    urlIntervalId: number | null;
    lastPath: string;
  } = {
    retries: 0,
    started: false,
    observer: null,
    urlIntervalId: null,
    lastPath: ""
  };

  function isTempChatActive() {
    return !!qs(TEMP_CHAT_OFF_SELECTOR);
  }

  function findVisibleBySelector(sel: string) {
    return (
      qsa<HTMLElement>(sel).find((el) => isElementVisible(el) && !el.hasAttribute("disabled")) ||
      null
    );
  }

  function persistTempChatEnabled(value: boolean) {
    tempChatEnabled = value;
    void storageSet({ tempChatEnabled }, storageApi, resolvedLastError);
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

  function handleTempChatManualToggle(e: MouseEvent) {
    if (!e.isTrusted) return;
    const target = e.target;
    if (!(target instanceof Element) || !target.closest) return;
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

    tempChatState.urlIntervalId = window.setInterval(() => {
      const cur = location.pathname + location.search;
      if (cur !== tempChatState.lastPath) {
        tempChatState.lastPath = cur;
        tempChatState.retries = 0;
        maybeEnableTempChat();
      }
    }, 100);

    maybeEnableTempChat();
  }

  const ONE_CLICK_DELETE_HOOK_MARK = "data-qqrm-oneclick-del-hooked";
  const ONE_CLICK_DELETE_X_MARK = "data-qqrm-oneclick-del-x";
  const ONE_CLICK_DELETE_STYLE_ID = "qqrm-oneclick-del-style";
  const ONE_CLICK_DELETE_ROOT_FLAG = "data-qqrm-oneclick-deleting";
  const ONE_CLICK_DELETE_BUTTON_SELECTOR =
    'button[data-testid^="history-item-"][data-testid$="-options"]';
  const ONE_CLICK_DELETE_RIGHT_ZONE_PX = 38;

  const ONE_CLICK_DELETE_BTN_H = 36;
  const ONE_CLICK_DELETE_BTN_W = 72;
  const ONE_CLICK_DELETE_X_SIZE = 26;
  const ONE_CLICK_DELETE_X_RIGHT = 6;
  const ONE_CLICK_DELETE_DOTS_LEFT = 10;

  const oneClickDeleteState: {
    started: boolean;
    deleting: boolean;
    observer: MutationObserver | null;
    intervalId: number | null;
  } = {
    started: false,
    deleting: false,
    observer: null,
    intervalId: null
  };

  function setOneClickDeleteDeleting(on: boolean) {
    if (on) document.documentElement.setAttribute(ONE_CLICK_DELETE_ROOT_FLAG, "1");
    else document.documentElement.removeAttribute(ONE_CLICK_DELETE_ROOT_FLAG);
  }

  function ensureOneClickDeleteStyle() {
    if (document.getElementById(ONE_CLICK_DELETE_STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = ONE_CLICK_DELETE_STYLE_ID;
    st.textContent = `
      ${ONE_CLICK_DELETE_BUTTON_SELECTOR}{
        width: ${ONE_CLICK_DELETE_BTN_W}px !important;
        height: ${ONE_CLICK_DELETE_BTN_H}px !important;
        border-radius: 12px !important;
        opacity: 1 !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        position: relative !important;
        padding: 0 !important;
        overflow: hidden !important;
      }

      ${ONE_CLICK_DELETE_BUTTON_SELECTOR} svg{
        position: absolute !important;
        left: ${ONE_CLICK_DELETE_DOTS_LEFT}px !important;
        top: 50% !important;
        transform: translateY(-50%) !important;
        pointer-events: none !important;
      }

      ${ONE_CLICK_DELETE_BUTTON_SELECTOR} > span[${ONE_CLICK_DELETE_X_MARK}="1"]{
        position: absolute;
        right: ${ONE_CLICK_DELETE_X_RIGHT}px;
        top: 50%;
        transform: translateY(-50%);
        width: ${ONE_CLICK_DELETE_X_SIZE}px;
        height: ${ONE_CLICK_DELETE_X_SIZE}px;
        border-radius: 9px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        font-weight: 600;
        line-height: 18px;
        color: #ff6b6b;
        background: rgba(255, 90, 90, 0.08);
        border: 1px solid rgba(255, 90, 90, 0.2);
        box-shadow: -1px 0 0 rgba(255, 255, 255, 0.08) inset;
        opacity: 0.0;
        transition: opacity 140ms ease, background 140ms ease, transform 140ms ease;
        user-select: none;
        pointer-events: none;
      }

      ${ONE_CLICK_DELETE_BUTTON_SELECTOR}:hover > span[${ONE_CLICK_DELETE_X_MARK}="1"],
      ${ONE_CLICK_DELETE_BUTTON_SELECTOR}:focus-visible > span[${ONE_CLICK_DELETE_X_MARK}="1"]{
        opacity: 1.0;
        background: rgba(255, 90, 90, 0.18);
        transform: translateY(-50%) scale(1.02);
      }

      @media (prefers-color-scheme: light) {
        ${ONE_CLICK_DELETE_BUTTON_SELECTOR} > span[${ONE_CLICK_DELETE_X_MARK}="1"]{
          color: #d93636;
          background: rgba(217, 54, 54, 0.08);
          border-color: rgba(217, 54, 54, 0.25);
          box-shadow: -1px 0 0 rgba(0, 0, 0, 0.08) inset;
        }
        ${ONE_CLICK_DELETE_BUTTON_SELECTOR}:hover > span[${ONE_CLICK_DELETE_X_MARK}="1"],
        ${ONE_CLICK_DELETE_BUTTON_SELECTOR}:focus-visible > span[${ONE_CLICK_DELETE_X_MARK}="1"]{
          background: rgba(217, 54, 54, 0.18);
        }
      }

      html[${ONE_CLICK_DELETE_ROOT_FLAG}="1"] div[data-testid="modal-delete-conversation-confirmation"]{
        opacity: 0 !important;
        pointer-events: none !important;
      }
      html[${ONE_CLICK_DELETE_ROOT_FLAG}="1"] [data-radix-menu-content][role="menu"]{
        opacity: 0 !important;
        pointer-events: none !important;
      }
      html[${ONE_CLICK_DELETE_ROOT_FLAG}="1"] [data-radix-popper-content-wrapper]{
        opacity: 0 !important;
        pointer-events: none !important;
      }
      html[${ONE_CLICK_DELETE_ROOT_FLAG}="1"] *{
        animation-duration: 0.001ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.001ms !important;
      }
    `;
    document.head.appendChild(st);
  }

  function removeOneClickDeleteStyle() {
    const st = document.getElementById(ONE_CLICK_DELETE_STYLE_ID);
    if (st) st.remove();
  }

  function ensureOneClickDeleteXSpan(btn: HTMLElement) {
    let x = btn.querySelector<HTMLSpanElement>(`span[${ONE_CLICK_DELETE_X_MARK}="1"]`);
    if (x) return x;
    x = document.createElement("span");
    x.setAttribute(ONE_CLICK_DELETE_X_MARK, "1");
    x.setAttribute("aria-label", "Delete chat");
    x.title = "Delete chat";
    x.textContent = "×";
    btn.appendChild(x);
    return x;
  }

  function clearOneClickDeleteButtons() {
    const btns = qsa<HTMLElement>(ONE_CLICK_DELETE_BUTTON_SELECTOR);
    for (const btn of btns) {
      btn.removeAttribute(ONE_CLICK_DELETE_HOOK_MARK);
      const x = btn.querySelector(`span[${ONE_CLICK_DELETE_X_MARK}="1"]`);
      if (x) x.remove();
    }
  }

  function hookOneClickDeleteButton(btn: HTMLElement) {
    if (!btn || btn.nodeType !== 1) return;
    if (btn.hasAttribute(ONE_CLICK_DELETE_HOOK_MARK)) return;
    btn.setAttribute(ONE_CLICK_DELETE_HOOK_MARK, "1");
    ensureOneClickDeleteXSpan(btn);
  }

  function isOneClickDeleteRightZone(btn: HTMLElement, ev: MouseEvent) {
    const rect = btn.getBoundingClientRect();
    const localX = ev.clientX - rect.left;
    return localX >= rect.width - ONE_CLICK_DELETE_RIGHT_ZONE_PX;
  }

  async function runOneClickDeleteFlow() {
    if (oneClickDeleteState.deleting) return;
    oneClickDeleteState.deleting = true;
    try {
      const deleteItem = await waitPresent(
        'div[role="menuitem"][data-testid="delete-chat-menu-item"]',
        document,
        1500
      );
      if (!deleteItem) return;
      setOneClickDeleteDeleting(true);
      humanClick(deleteItem as HTMLElement, "oneclick-delete-menu");

      const modal = await waitPresent(
        'div[data-testid="modal-delete-conversation-confirmation"]',
        document,
        2000
      );
      if (!modal) return;

      const confirmBtn =
        modal.querySelector('button[data-testid="delete-conversation-confirm-button"]') ||
        (await waitPresent(
          'button[data-testid="delete-conversation-confirm-button"]',
          modal,
          1500
        ));

      if (!confirmBtn) return;
      humanClick(confirmBtn as HTMLElement, "oneclick-delete-confirm");
    } finally {
      await sleep(120);
      setOneClickDeleteDeleting(false);
      oneClickDeleteState.deleting = false;
    }
  }

  function refreshOneClickDelete() {
    if (!CFG.oneClickDeleteEnabled) return;
    ensureOneClickDeleteStyle();
    const btns = qsa<HTMLElement>(ONE_CLICK_DELETE_BUTTON_SELECTOR);
    for (const btn of btns) hookOneClickDeleteButton(btn);
  }

  function handleOneClickDeleteClick(ev: MouseEvent) {
    if (!CFG.oneClickDeleteEnabled) return;
    if (!ev.isTrusted) return;
    const target = ev.target;
    if (!(target instanceof Element) || !target.closest) return;
    const btn = target.closest(ONE_CLICK_DELETE_BUTTON_SELECTOR);
    if (!(btn instanceof HTMLElement)) return;
    if (!isOneClickDeleteRightZone(btn, ev)) return;
    setTimeout(() => {
      runOneClickDeleteFlow().catch(() => {});
    }, 0);
  }

  function startOneClickDelete() {
    if (oneClickDeleteState.started) return;
    oneClickDeleteState.started = true;

    document.addEventListener("click", handleOneClickDeleteClick, true);

    refreshOneClickDelete();
    oneClickDeleteState.intervalId = window.setInterval(refreshOneClickDelete, 1200);

    oneClickDeleteState.observer = new MutationObserver(() => refreshOneClickDelete());
    oneClickDeleteState.observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function stopOneClickDelete() {
    if (!oneClickDeleteState.started) return;
    oneClickDeleteState.started = false;

    document.removeEventListener("click", handleOneClickDeleteClick, true);

    if (oneClickDeleteState.intervalId !== null) {
      window.clearInterval(oneClickDeleteState.intervalId);
      oneClickDeleteState.intervalId = null;
    }
    if (oneClickDeleteState.observer) {
      oneClickDeleteState.observer.disconnect();
      oneClickDeleteState.observer = null;
    }

    clearOneClickDeleteButtons();
    removeOneClickDeleteStyle();
    setOneClickDeleteDeleting(false);
  }

  function updateOneClickDeleteState() {
    if (CFG.oneClickDeleteEnabled) startOneClickDelete();
    else stopOneClickDelete();
  }

  void refreshSettings();
  if (
    storageApi &&
    storageApi.onChanged &&
    typeof storageApi.onChanged.addListener === "function"
  ) {
    storageApi.onChanged.addListener(
      (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => {
        if (areaName !== "sync" && areaName !== "local") return;
        if (
          !changes ||
          (!("autoExpandChats" in changes) &&
            !("skipKey" in changes) &&
            !("holdToSend" in changes) &&
            !("autoTempChat" in changes) &&
            !("oneClickDelete" in changes) &&
            !("tempChatEnabled" in changes))
        ) {
          return;
        }
        if ("autoExpandChats" in changes) {
          const prev = Boolean(changes.autoExpandChats.oldValue);
          const next = Boolean(changes.autoExpandChats.newValue);
          if (next && !prev) {
            autoExpandReset();
            startAutoExpand();
          }
          if (!next && prev) {
            stopAutoExpand();
          }
        }
        void refreshSettings();
      }
    );
  }

  const AUTO_EXPAND_LOOP_MS = 400;
  const AUTO_EXPAND_CLICK_COOLDOWN_MS = 1500;
  const autoExpandState: {
    running: boolean;
    started: boolean;
    completed: boolean;
    lastClickAtByKey: Map<string, number>;
    intervalId: number | null;
    observer: MutationObserver | null;
  } = {
    running: false,
    started: false,
    completed: false,
    lastClickAtByKey: new Map(),
    intervalId: null,
    observer: null
  };

  function autoExpandCanClick(key: string) {
    const t = autoExpandState.lastClickAtByKey.get(key) || 0;
    return Date.now() - t > AUTO_EXPAND_CLICK_COOLDOWN_MS;
  }

  function autoExpandMarkClick(key: string) {
    autoExpandState.lastClickAtByKey.set(key, Date.now());
  }

  function autoExpandDispatchClick(el: HTMLElement) {
    const seq = ["pointerdown", "mousedown", "mouseup", "click"];
    for (const t of seq) {
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    }
  }

  function autoExpandReset() {
    autoExpandState.running = false;
    autoExpandState.started = false;
    autoExpandState.completed = false;
    autoExpandState.lastClickAtByKey.clear();
  }

  function autoExpandClickIfPossible(key: string, el: HTMLElement | null, reason: string) {
    if (!el) return false;
    if (!isElementVisible(el)) return false;
    if (!autoExpandCanClick(key)) return false;
    autoExpandMarkClick(key);
    tmLog("AUTOEXPAND", `click ${key}`, { preview: reason });
    autoExpandDispatchClick(el);
    return true;
  }

  function autoExpandSidebarEl() {
    return qs<HTMLElement>("#stage-slideover-sidebar");
  }

  function autoExpandSidebarIsOpen() {
    const sb = autoExpandSidebarEl();
    if (!sb) return false;
    if (!isElementVisible(sb)) return false;
    return sb.getBoundingClientRect().width >= 120;
  }

  function autoExpandOpenSidebarButton() {
    return (
      qs<HTMLButtonElement>(
        '#stage-sidebar-tiny-bar button[aria-label="Open sidebar"][aria-controls="stage-slideover-sidebar"]'
      ) ||
      qs<HTMLButtonElement>(
        'button[aria-label="Open sidebar"][aria-controls="stage-slideover-sidebar"]'
      )
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

  function autoExpandFindYourChatsSection(nav: Element | null) {
    if (!nav) return null;

    const sections = Array.from(nav.querySelectorAll("div.group\\/sidebar-expando-section"));
    for (const sec of sections) {
      const t = norm(sec.textContent);
      if (
        t.includes("your chats") ||
        t.includes("your charts") ||
        t.includes("чаты") ||
        t.includes("история")
      ) {
        return sec;
      }
    }

    if (sections.length >= 4) return sections[3];
    return null;
  }

  function autoExpandSectionCollapsed(sec: Element) {
    const cls = String((sec as HTMLElement).className || "");
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

    const btn =
      (sec as HTMLElement).querySelector("button.text-token-text-tertiary.flex.w-full") ||
      (sec as HTMLElement).querySelector("button") ||
      (sec as HTMLElement).querySelector('[role="button"]');

    return autoExpandClickIfPossible(
      "expandYourChats",
      btn as HTMLElement | null,
      "section looks collapsed"
    );
  }

  function autoExpandTryFinish() {
    if (!autoExpandSidebarIsOpen()) {
      autoExpandEnsureSidebarOpen();
      return false;
    }

    const nav = autoExpandChatHistoryNav();
    if (!nav || !isElementVisible(nav)) return false;

    const sec = autoExpandFindYourChatsSection(nav);
    if (!sec) return false;

    if (!autoExpandSectionCollapsed(sec)) return true;

    return autoExpandExpandYourChats();
  }

  function stopAutoExpand() {
    if (autoExpandState.intervalId !== null) {
      window.clearInterval(autoExpandState.intervalId);
      autoExpandState.intervalId = null;
    }
    if (autoExpandState.observer) {
      autoExpandState.observer.disconnect();
      autoExpandState.observer = null;
    }
  }

  function autoExpandTick() {
    if (!CFG.autoExpandChatsEnabled) return;
    if (autoExpandState.completed) return;
    if (autoExpandState.running) return;
    autoExpandState.running = true;
    try {
      const done = autoExpandTryFinish();
      if (done) {
        autoExpandState.completed = true;
        stopAutoExpand();
      }
    } catch (e) {
      tmLog("AUTOEXPAND", "tick error", {
        preview: String((e && (e as Error).stack) || (e as Error).message || e)
      });
    } finally {
      autoExpandState.running = false;
    }
  }

  function startAutoExpand() {
    if (autoExpandState.started) return;
    autoExpandState.started = true;
    autoExpandTick();

    autoExpandState.intervalId = window.setInterval(autoExpandTick, AUTO_EXPAND_LOOP_MS);

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
    (e: MouseEvent) => {
      const target = e.target;
      const btn = target instanceof Element && target.closest ? target.closest("button") : null;
      if (!btn) return;

      const btnDesc = describeEl(btn);

      if (CFG.logClicks && btn instanceof HTMLButtonElement && isInterestingButton(btn)) {
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

      if (CFG.enabled && btn instanceof HTMLButtonElement && isSubmitDictationButton(btn)) {
        void refreshSettings();
        void runFlowAfterSubmitClick(btnDesc, isModifierHeldFromEvent(e));
      }
    },
    true
  );

  tmLog("BOOT", "content script loaded", { preview: location.href });
};
