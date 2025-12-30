export interface AutoSendDecision {
  shouldSend: boolean;
  heldDuring: boolean;
  holdToSend: boolean;
}

export interface AutoSendRequestedEvent {
  type: "AutoSendRequested";
  decision: AutoSendDecision;
}

export interface AutoSendCompletedEvent {
  type: "AutoSendCompleted";
  success: boolean;
}
