import { describe, expect, it } from "vitest";
import { buildAutoSendHint } from "../../src/application/popupUseCases";

describe("buildAutoSendHint", () => {
  it("explains always-on behavior when no modifier is selected", () => {
    const hint = buildAutoSendHint("None", false);
    expect(hint).toBe("Auto-send always happens when you accept dictation.");
  });

  it("explains hold-to-send behavior for a modifier", () => {
    const hint = buildAutoSendHint("Shift", true);
    expect(hint).toBe("Auto-send happens only while holding Shift when you accept dictation.");
  });
});
