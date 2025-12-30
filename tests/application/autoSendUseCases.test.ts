import { describe, expect, it } from "vitest";
import { decideAutoSend } from "../../src/application/autoSendUseCases";

describe("decideAutoSend", () => {
  it("sends when hold-to-send is enabled and modifier is held", () => {
    const decision = decideAutoSend({ holdToSend: true, heldDuring: true });
    expect(decision.shouldSend).toBe(true);
  });

  it("skips send when hold-to-send is enabled and modifier is not held", () => {
    const decision = decideAutoSend({ holdToSend: true, heldDuring: false });
    expect(decision.shouldSend).toBe(false);
  });

  it("sends when hold-to-send is disabled and modifier is not held", () => {
    const decision = decideAutoSend({ holdToSend: false, heldDuring: false });
    expect(decision.shouldSend).toBe(true);
  });

  it("skips send when hold-to-send is disabled and modifier is held", () => {
    const decision = decideAutoSend({ holdToSend: false, heldDuring: true });
    expect(decision.shouldSend).toBe(false);
  });
});
