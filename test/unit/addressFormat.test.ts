import {
  addressPoliciesForSchema,
  isServerMainAddressPlaceholder,
  looksLikeAddressToken,
  validateHaproxyAddress,
} from "../../src/addressFormat";
import { loadSchema } from "../helpers/schema";

const schema = loadSchema("3.4");
const policies = addressPoliciesForSchema(schema);

describe("validateHaproxyAddress", () => {
  it("exposes schema-backed address policies", () => {
    expect(addressPoliciesForSchema(schema).bind).toEqual(policies.bind);
  });

  it("rejects empty addresses", () => {
    expect(validateHaproxyAddress("", policies.bind).code).toBe("invalid-address");
  });

  it("accepts bind addresses with required ports", () => {
    expect(validateHaproxyAddress(":8080", policies.bind)).toEqual({ valid: true });
    expect(validateHaproxyAddress(":::8080", policies.bind)).toEqual({ valid: true });
    expect(validateHaproxyAddress("127.0.0.1:8080", policies.bind)).toEqual({
      valid: true,
    });
  });

  it("requires port for bind", () => {
    expect(validateHaproxyAddress(":", policies.bind).code).toBe("missing-port");
    expect(validateHaproxyAddress("127.0.0.1", policies.bind).code).toBe("missing-port");
  });

  it("allows optional ports for log and source", () => {
    expect(validateHaproxyAddress("127.0.0.1", policies.log)).toEqual({ valid: true });
    expect(validateHaproxyAddress("127.0.0.1:514", policies.log)).toEqual({ valid: true });
    expect(validateHaproxyAddress("127.0.0.1", policies.source)).toEqual({ valid: true });
  });

  it("rejects port ranges where not permitted", () => {
    const result = validateHaproxyAddress("127.0.0.1:10001-10010", policies.log);
    expect(result.code).toBe("port-range-not-permitted");
  });

  it("rejects port offsets where not permitted", () => {
    expect(validateHaproxyAddress("127.0.0.1:+10011", policies.log).code).toBe(
      "port-offset-not-permitted",
    );
    expect(validateHaproxyAddress("127.0.0.1:-10012", policies.log).code).toBe(
      "port-offset-not-permitted",
    );
  });

  it("allows port offsets on server main addresses", () => {
    expect(validateHaproxyAddress(":+13003", policies.server)).toEqual({ valid: true });
    expect(validateHaproxyAddress(":-13004", policies.server)).toEqual({ valid: true });
  });

  it("rejects port ranges on server main addresses", () => {
    expect(validateHaproxyAddress(":13005-13010", policies.server).code).toBe(
      "port-range-not-permitted",
    );
  });

  it("validates server source and usesrc policies", () => {
    expect(validateHaproxyAddress("localhost:15000", policies.serverSource)).toEqual({
      valid: true,
    });
    expect(validateHaproxyAddress("0.0.0.1:+15002", policies.serverUsesrc).code).toBe(
      "port-offset-not-permitted",
    );
    expect(validateHaproxyAddress("0.0.0.1:16004-16010", policies.serverUsesrc).code).toBe(
      "port-range-not-permitted",
    );
  });

  it("requires port for socks4 server addresses", () => {
    expect(validateHaproxyAddress("0.0.0.1", policies.serverSocks4).code).toBe("missing-port");
    expect(validateHaproxyAddress("0.0.0.1:18001", policies.serverSocks4)).toEqual({
      valid: true,
    });
  });

  it("validates tcp-check addr policy", () => {
    expect(validateHaproxyAddress("0.0.0.1", policies.tcpCheckAddr)).toEqual({
      valid: true,
    });
    expect(validateHaproxyAddress("0.0.0.1:19004-19005", policies.tcpCheckAddr).code).toBe(
      "port-range-not-permitted",
    );
  });

  it("rejects invalid ipv4 hosts", () => {
    expect(validateHaproxyAddress("999.999.999.999:80", policies.bind).code).toBe(
      "invalid-address",
    );
  });

  it("accepts unix socket paths", () => {
    expect(validateHaproxyAddress("/run/haproxy.sock", policies.log)).toEqual({
      valid: true,
    });
  });

  it("rejects dgram bind when port range mandatory without offset", () => {
    expect(validateHaproxyAddress("udp@:11013", policies.bind).code).toBe("invalid-address");
  });

  it("validates bind port ranges and invalid ports", () => {
    expect(validateHaproxyAddress(":::11003-11010", policies.bind)).toEqual({
      valid: true,
    });
    expect(validateHaproxyAddress(":::0", policies.bind).code).toBe("invalid-port");
    expect(validateHaproxyAddress(":::65016-", policies.bind).code).toBe("invalid-port");
    expect(validateHaproxyAddress(":::65016-1024", policies.bind).code).toBe("invalid-port");
    expect(validateHaproxyAddress(":::66016-1024", policies.bind).code).toBe("invalid-port");
  });

  it("validates unix socket paths", () => {
    expect(validateHaproxyAddress("/var/run/haproxy.sock", policies.log)).toEqual({
      valid: true,
    });
    expect(validateHaproxyAddress("/", policies.log).code).toBe("invalid-address");
  });

  it("parses bracketed IPv6 addresses with ports", () => {
    expect(validateHaproxyAddress("[::1]:8080", policies.bind)).toEqual({ valid: true });
    expect(validateHaproxyAddress("[::1]", policies.bind).code).toBe("missing-port");
    expect(validateHaproxyAddress("[::1]", policies.log)).toEqual({ valid: true });
  });

  it("rejects malformed prefixed bracketed IPv6 addresses", () => {
    expect(validateHaproxyAddress("ipv6@[::1]:8080", policies.bind).code).toBe("invalid-address");
  });

  it("accepts wildcard ipv4 hosts", () => {
    expect(validateHaproxyAddress("*:8080", policies.bind)).toEqual({ valid: true });
  });

  it("rejects invalid hostname labels", () => {
    expect(validateHaproxyAddress("bad..host:80", policies.bind).code).toBe("invalid-address");
    expect(validateHaproxyAddress("bad!host:80", policies.bind).code).toBe("invalid-address");
    expect(validateHaproxyAddress("host]:80", policies.bind).code).toBe("invalid-address");
    expect(validateHaproxyAddress("host]", policies.log).code).toBe("invalid-address");
  });

  it("accepts udp@ without host body", () => {
    expect(validateHaproxyAddress("udp@", policies.log)).toEqual({ valid: true });
  });

  it("rejects ports when portOk is false", () => {
    const policy = { portOk: false, portMandatory: false, portRange: false, portOffset: false };
    expect(validateHaproxyAddress("127.0.0.1:80", policy).code).toBe("port-not-permitted");
  });

  it("rejects invalid port offsets and ranges", () => {
    expect(validateHaproxyAddress("127.0.0.1:+bad", policies.server).code).toBe("invalid-port");
    expect(validateHaproxyAddress("127.0.0.1:-bad", policies.server).code).toBe("invalid-port");
    expect(validateHaproxyAddress(":::65016-70000", policies.bind).code).toBe("invalid-port");
    expect(validateHaproxyAddress("127.0.0.1:bad", policies.log).code).toBe("invalid-port");
  });

  it("requires ports on unix sockets when mandatory", () => {
    expect(validateHaproxyAddress("/tmp/sock:8080", policies.serverSocks4)).toEqual({
      valid: true,
    });
    expect(validateHaproxyAddress("/tmp/sock", policies.serverSocks4).code).toBe("missing-port");
  });

  it("handles host-only port separator", () => {
    expect(validateHaproxyAddress(":8080", policies.bind)).toEqual({ valid: true });
  });
});

describe("isServerMainAddressPlaceholder", () => {
  it("detects colon-only server address placeholder", () => {
    expect(isServerMainAddressPlaceholder(":")).toBe(true);
    expect(isServerMainAddressPlaceholder(" : ")).toBe(true);
    expect(isServerMainAddressPlaceholder("127.0.0.1:8080")).toBe(false);
  });
});

describe("looksLikeAddressToken", () => {
  it("recognizes common address shapes", () => {
    expect(looksLikeAddressToken(":8080")).toBe(true);
    expect(looksLikeAddressToken("127.0.0.1:8080")).toBe(true);
    expect(looksLikeAddressToken("/run/haproxy.sock")).toBe(true);
    expect(looksLikeAddressToken("web-name")).toBe(false);
    expect(looksLikeAddressToken(":")).toBe(false);
    expect(looksLikeAddressToken("ipv4@127.0.0.1:80")).toBe(true);
    expect(looksLikeAddressToken("[::1]:8080")).toBe(true);
    expect(looksLikeAddressToken("bad!host:80")).toBe(true);
    expect(looksLikeAddressToken("bad!host:+80")).toBe(true);
  });
});

describe("ports.cfg expectations", () => {
  it("documents bind and log address messages from golden ports.cfg", () => {
    expect(validateHaproxyAddress(":", policies.bind).message).toContain("missing port");
    expect(validateHaproxyAddress("127.0.0.1:10001-10010", policies.log).message).toContain(
      "port range not permitted",
    );
  });
});
