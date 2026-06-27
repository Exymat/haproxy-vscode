import { CompletionKind } from "./documentContext";

export const ACTION_GROUP_NAMES = [
  "http_request_actions",
  "http_response_actions",
  "http_after_response_actions",
  "tcp_request_actions",
  "tcp_response_actions",
] as const;

export const DEPRECATED_ACTION_GROUP_NAMES = [
  ...ACTION_GROUP_NAMES,
  "quic_initial_actions",
] as const;

export type ActionGroupName = (typeof ACTION_GROUP_NAMES)[number];

const COMPLETION_KIND_TO_ACTION_GROUP: Partial<Record<CompletionKind, ActionGroupName>> = {
  "http-request": "http_request_actions",
  "http-response": "http_response_actions",
  "http-after-response": "http_after_response_actions",
  "tcp-request": "tcp_request_actions",
  "tcp-response": "tcp_response_actions",
};

export function actionGroupForCompletionKind(kind: string): ActionGroupName | null {
  return COMPLETION_KIND_TO_ACTION_GROUP[kind as CompletionKind] ?? null;
}

export function lineOptionGroupForKind(kind: string): "bind_options" | "server_options" | null {
  if (kind === "bind") {
    return "bind_options";
  }
  if (kind === "server") {
    return "server_options";
  }
  return null;
}

export function sampleExpressionGroupForKind(
  kind: string,
): "sample_fetches" | "sample_converters" | null {
  if (kind === "expression-fetch") {
    return "sample_fetches";
  }
  if (kind === "expression-converter") {
    return "sample_converters";
  }
  return null;
}

export const ACL_CRITERION_GROUPS = ["acl_criteria", "sample_fetches"] as const;

export const LOG_FORMAT_GROUPS = {
  flags: "logformat_flags",
  aliases: "logformat_aliases",
} as const;

export const COMMON_LANGUAGE_GROUPS = {
  options: "options",
  services: "services",
  filters: "filters",
} as const;
