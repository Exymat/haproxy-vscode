/**
 * HAProxy address + port validation aligned with str2sa_range() (tools.c) and PA_O_PORT_* flags.
 */

export interface PortAddressPolicy {
  portOk: boolean;
  portMandatory: boolean;
  portRange: boolean;
  portOffset: boolean;
}

/** Mirrors include/haproxy/tools-t.h PA_O_PORT_* usage per keyword. */
export const ADDRESS_POLICIES = {
  bind: { portOk: true, portMandatory: true, portRange: true, portOffset: false },
  log: { portOk: true, portMandatory: false, portRange: false, portOffset: false },
  source: { portOk: true, portMandatory: false, portRange: false, portOffset: false },
  server: { portOk: true, portMandatory: false, portRange: false, portOffset: true },
  serverSource: { portOk: true, portMandatory: false, portRange: true, portOffset: false },
  serverUsesrc: { portOk: true, portMandatory: false, portRange: false, portOffset: false },
  serverSocks4: { portOk: true, portMandatory: true, portRange: false, portOffset: false },
  tcpCheckAddr: { portOk: true, portMandatory: false, portRange: false, portOffset: false },
} as const satisfies Record<string, PortAddressPolicy>;

export type AddressPolicyName = keyof typeof ADDRESS_POLICIES;

export interface AddressValidationResult {
  valid: boolean;
  message?: string;
  code?:
    | "invalid-address"
    | "missing-port"
    | "port-not-permitted"
    | "port-range-not-permitted"
    | "port-offset-not-permitted"
    | "invalid-port";
}

const ADDRESS_PREFIX_RE =
  /^(?:(?:stream|dgram|quic)\+)?(?:ipv4|ipv6|ip|unix|uxdg@|uxst@|fd@|abnsz?@|sockpair@|tcp4@|tcp6@|udp4@|udp6@|tcp@|udp@|quic4@|quic6@|mptcp4@|mptcp6@|mptcp@)/i;

const IPV4_OCTET = /^(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;

function stripAddressPrefixes(token: string): { body: string; prefix: string } {
  const match = ADDRESS_PREFIX_RE.exec(token);
  if (!match) {
    return { body: token, prefix: "" };
  }
  return { body: token.slice(match[0].length), prefix: match[0].toLowerCase() };
}

function splitHostAndPort(token: string): {
  host: string;
  portPart: string;
  hadPortSeparator: boolean;
} {
  const trimmed = token.trim();
  if (trimmed.startsWith("[")) {
    const close = trimmed.indexOf("]");
    /* v8 ignore start -- bracketed hosts without a trailing port separator are accepted as pure host tokens */
    if (close > 0) {
      const host = trimmed.slice(0, close + 1);
      const rest = trimmed.slice(close + 1);
      if (rest.startsWith(":")) {
        return { host, portPart: rest.slice(1), hadPortSeparator: true };
      }
      return { host, portPart: "", hadPortSeparator: false };
    }
    /* v8 ignore stop */
  }

  let hostEnd = trimmed.length;
  let hadPortSeparator = false;
  for (let i = trimmed.length - 1; i >= 0; i -= 1) {
    const ch = trimmed[i];
    /* v8 ignore start -- malformed trailing brackets are rejected later by host validation */
    if (ch === "]") {
      break;
    }
    /* v8 ignore stop */
    if (ch === ":") {
      hostEnd = i;
      hadPortSeparator = true;
      break;
    }
  }

  const host = trimmed.slice(0, hostEnd);
  const portPart = hadPortSeparator ? trimmed.slice(hostEnd + 1) : "";
  if (!host && portPart) {
    return { host: "*", portPart, hadPortSeparator: true };
  }
  return { host, portPart, hadPortSeparator };
}

function isValidIpv4Host(host: string): boolean {
  const parts = host.split(".");
  if (parts.length < 2 || parts.length > 4) {
    return false;
  }
  return parts.every((part) => IPV4_OCTET.test(part));
}

function isValidIpv6Host(host: string): boolean {
  if (host.startsWith("[") && host.endsWith("]")) {
    const inner = host.slice(1, -1);
    return inner.length > 0 && /^[0-9a-fA-F:.]+$/.test(inner);
  }
  return host.includes(":") && /^[0-9a-fA-F:.]+$/.test(host);
}

function isValidBareHost(host: string): boolean {
  if (!host || host === "*" || host === "::") {
    return true;
  }
  if (!/^[A-Za-z0-9*._-]+$/.test(host)) {
    return false;
  }
  return host === "localhost";
}

function validateHostShape(host: string): AddressValidationResult {
  const { body } = stripAddressPrefixes(host);
  if (isValidIpv6Host(body)) {
    return { valid: true };
  }
  if (body.includes(".")) {
    if (isValidIpv4Host(body)) {
      return { valid: true };
    }
    return {
      valid: false,
      message: `invalid IPv4 address '${body}'`,
      code: "invalid-address",
    };
  }
  if (isValidBareHost(body)) {
    return { valid: true };
  }
  return {
    valid: false,
    message: `invalid address '${host}'`,
    code: "invalid-address",
  };
}

function validatePortPart(
  portPart: string,
  policy: PortAddressPolicy,
  full: string,
): AddressValidationResult {
  if (!portPart) {
    if (policy.portMandatory) {
      return {
        valid: false,
        message: `missing port specification in '${full}'`,
        code: "missing-port",
      };
    }
    return { valid: true };
  }

  if (!policy.portOk) {
    return {
      valid: false,
      message: `port specification not permitted here in '${full}'`,
      code: "port-not-permitted",
    };
  }

  if (portPart.startsWith("+")) {
    if (!policy.portOffset) {
      return {
        valid: false,
        message: `port offset not permitted here in '${full}'`,
        code: "port-offset-not-permitted",
      };
    }
    const num = portPart.slice(1);
    if (!/^\d+$/.test(num)) {
      return { valid: false, message: `invalid port '${portPart}'`, code: "invalid-port" };
    }
    return { valid: true };
  }

  if (portPart.startsWith("-")) {
    if (!policy.portOffset) {
      return {
        valid: false,
        message: `port offset not permitted here in '${full}'`,
        code: "port-offset-not-permitted",
      };
    }
    const num = portPart.slice(1);
    if (!/^\d+$/.test(num)) {
      return { valid: false, message: `invalid port '${portPart}'`, code: "invalid-port" };
    }
    return { valid: true };
  }

  const dash = portPart.indexOf("-");
  if (dash >= 0) {
    if (!policy.portRange) {
      return {
        valid: false,
        message: `port range not permitted here in '${full}'`,
        code: "port-range-not-permitted",
      };
    }
    const low = portPart.slice(0, dash);
    const high = portPart.slice(dash + 1);
    if (!/^\d+$/.test(low) || !/^\d*$/.test(high)) {
      return { valid: false, message: `invalid port range '${portPart}'`, code: "invalid-port" };
    }
    const portLow = Number.parseInt(low, 10);
    const portHigh = high ? Number.parseInt(high, 10) : portLow;
    if (portLow < (policy.portMandatory ? 1 : 0) || portLow > 65535) {
      return { valid: false, message: `invalid port '${low}'`, code: "invalid-port" };
    }
    if (!high) {
      return { valid: false, message: `invalid port ''`, code: "invalid-port" };
    }
    if (portHigh < (policy.portMandatory ? 1 : 0) || portHigh > 65535) {
      return { valid: false, message: `invalid port '${high}'`, code: "invalid-port" };
    }
    if (portLow > portHigh) {
      return { valid: false, message: `invalid port range '${portPart}'`, code: "invalid-port" };
    }
    return { valid: true };
  }

  if (!/^\d+$/.test(portPart)) {
    return { valid: false, message: `invalid port '${portPart}'`, code: "invalid-port" };
  }
  const port = Number.parseInt(portPart, 10);
  const minPort = policy.portMandatory ? 1 : 0;
  if (port < minPort || port > 65535) {
    return { valid: false, message: `invalid port '${portPart}'`, code: "invalid-port" };
  }
  return { valid: true };
}

export function validateHaproxyAddress(
  token: string,
  policy: PortAddressPolicy,
): AddressValidationResult {
  const trimmed = token.trim();
  if (!trimmed) {
    return { valid: false, message: "address is empty", code: "invalid-address" };
  }

  const { body, prefix } = stripAddressPrefixes(trimmed);
  if (body.startsWith("/")) {
    if (policy.portMandatory) {
      const { portPart, hadPortSeparator } = splitHostAndPort(trimmed);
      if (hadPortSeparator) {
        return validatePortPart(portPart, policy, trimmed);
      }
      return {
        valid: false,
        message: `missing port specification in '${trimmed}'`,
        code: "missing-port",
      };
    }
    return body.length > 1
      ? { valid: true }
      : { valid: false, message: "unix socket path is empty", code: "invalid-address" };
  }

  if (prefix.startsWith("udp@") && policy.portRange && policy.portMandatory && !policy.portOffset) {
    return {
      valid: false,
      message: `dgram-type address not acceptable in '${trimmed}'`,
      code: "invalid-address",
    };
  }

  const { host, portPart, hadPortSeparator } = splitHostAndPort(trimmed);
  const hostResult = validateHostShape(host || body);
  if (!hostResult.valid) {
    return hostResult;
  }

  if (!hadPortSeparator) {
    if (policy.portMandatory) {
      return {
        valid: false,
        message: `missing port specification in '${trimmed}'`,
        code: "missing-port",
      };
    }
    return { valid: true };
  }

  return validatePortPart(portPart, policy, trimmed);
}

/** Server/backend address may be ":" alone (inherit port mapping). */
export function isServerMainAddressPlaceholder(token: string): boolean {
  return token.trim() === ":";
}

export function looksLikeAddressToken(token: string): boolean {
  const trimmed = token.trim();
  if (!trimmed || trimmed === ":") {
    return false;
  }
  if (trimmed.startsWith("/") || trimmed === "*" || trimmed === "::") {
    return true;
  }
  if (ADDRESS_PREFIX_RE.test(trimmed)) {
    return true;
  }
  if (trimmed.startsWith("[")) {
    return true;
  }
  const { host, portPart, hadPortSeparator } = splitHostAndPort(trimmed);
  if (hadPortSeparator && portPart) {
    /* v8 ignore start -- address-token heuristics allow either a valid host or port-like suffix while typing */
    return (
      validateHostShape(host).valid ||
      /^\d/.test(portPart) ||
      portPart.startsWith("+") ||
      portPart.startsWith("-")
    );
    /* v8 ignore stop */
  }
  return host.includes(".") || host.includes(":");
}
