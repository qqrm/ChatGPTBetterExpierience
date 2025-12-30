import { AutoSendDecision } from "../domain/autoSend";

export interface AutoSendDecisionInput {
  holdToSend: boolean;
  heldDuring: boolean;
}

export function decideAutoSend({
  holdToSend,
  heldDuring
}: AutoSendDecisionInput): AutoSendDecision {
  return {
    holdToSend,
    heldDuring,
    shouldSend: holdToSend ? heldDuring : !heldDuring
  };
}
