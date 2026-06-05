import { HaproxyVersion } from "./version";

export interface ConditionalDirectiveInfo {
  name: string;
  signature: string;
  description: string;
}

const CONDITIONAL_BLOCK_DOCS: ConditionalDirectiveInfo[] = [
  {
    name: ".if",
    signature: ".if <condition>",
    description:
      "Start a nested conditional block. The following lines are included only when the expression is true.",
  },
  {
    name: ".elif",
    signature: ".elif <condition>",
    description: "Alternate branch at the same nesting level as the preceding .if or .elif.",
  },
  {
    name: ".else",
    signature: ".else",
    description: "Final alternate branch for the current .if block (at most one .else per .if).",
  },
  {
    name: ".endif",
    signature: ".endif",
    description: "Close one nesting level opened by .if.",
  },
];

const STATUS_DIRECTIVES: ConditionalDirectiveInfo[] = [
  {
    name: ".diag",
    signature: '.diag "message"',
    description: "Emit a message only when HAProxy runs in diagnostic mode (-dD).",
  },
  {
    name: ".notice",
    signature: '.notice "message"',
    description: "Emit a message at log level NOTICE during configuration parsing.",
  },
  {
    name: ".warning",
    signature: '.warning "message"',
    description:
      "Emit a message at log level WARNING during parsing (may fail startup when zero-warning is enabled).",
  },
  {
    name: ".alert",
    signature: '.alert "message"',
    description: "Emit a message at log level ALERT during parsing (always causes a fatal error).",
  },
];

const BY_NAME = new Map<string, ConditionalDirectiveInfo>();
for (const entry of [...CONDITIONAL_BLOCK_DOCS, ...STATUS_DIRECTIVES]) {
  BY_NAME.set(entry.name.toLowerCase(), entry);
}

export function conditionalBlocksDocsUrl(version: HaproxyVersion): string {
  return `https://docs.haproxy.org/${version}/configuration.html#2.4`;
}

export function lookupConditionalDirective(token: string): ConditionalDirectiveInfo | undefined {
  return BY_NAME.get(token.toLowerCase());
}

export function isConditionalOrStatusDirective(token: string | undefined): boolean {
  if (!token) {
    return false;
  }
  return BY_NAME.has(token.toLowerCase());
}
