export interface ArrowUpEditDecisionInput {
  enabled: boolean;
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  inputText: string;
}

export function shouldTriggerArrowUpEdit({
  enabled,
  key,
  altKey,
  ctrlKey,
  metaKey,
  shiftKey,
  isComposing,
  inputText
}: ArrowUpEditDecisionInput): boolean {
  if (!enabled) return false;
  if (key !== "ArrowUp") return false;
  if (isComposing) return false;
  if (altKey || ctrlKey || metaKey || shiftKey) return false;
  return (inputText || "").trim().length === 0;
}
