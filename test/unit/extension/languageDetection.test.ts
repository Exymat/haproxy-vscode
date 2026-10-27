import { describe, expect, it } from "vitest";

import { detectHaproxyConfig } from "../../../src/extension/languageDetection";

describe("detectHaproxyConfig", () => {
  it("accepts a comment block followed by a frontend section", () => {
    expect(detectHaproxyConfig(["# generated", "", "frontend fe"])).toBe(true);
  });

  it("accepts global once an indented directive confirms it", () => {
    expect(detectHaproxyConfig(["# site", "global", "    maxconn 2000"])).toBe(true);
    expect(detectHaproxyConfig(["global", "", "    daemon"])).toBe(true);
  });

  it("accepts peers once an indented peer line confirms it", () => {
    expect(detectHaproxyConfig(["# cluster", "peers name", "    peer s1 10.0.0.1:1024"])).toBe(
      true,
    );
  });

  it("accepts defaults once mode http confirms it", () => {
    expect(detectHaproxyConfig(["defaults", "    mode http"])).toBe(true);
    expect(detectHaproxyConfig(["defaults web", "    mode http"])).toBe(true);
    expect(detectHaproxyConfig(["defaults from base", "    mode tcp"])).toBe(true);
    expect(detectHaproxyConfig(["defaults web from base", "    mode tcp"])).toBe(true);
    expect(detectHaproxyConfig(["defaults", "    mode log"])).toBe(true);
  });

  it("accepts a hyphenated section after a conditional preamble", () => {
    expect(detectHaproxyConfig([".if version_atleast(3.1)", "http-errors errors"])).toBe(true);
  });

  it("accepts frontend with a from profile and a trailing comment", () => {
    expect(detectHaproxyConfig(["frontend web from http # public"])).toBe(true);
    expect(detectHaproxyConfig(["global# comment", "    nbthread 2"])).toBe(true);
  });

  it("rejects prose, a lone global, nginx blocks, and indented headers", () => {
    expect(detectHaproxyConfig(["peers in the cluster"])).toBe(false);
    expect(detectHaproxyConfig(["global settings for prod"])).toBe(false);
    expect(detectHaproxyConfig(["global"])).toBe(false);
    expect(detectHaproxyConfig(["# only comments"])).toBe(false);
    expect(detectHaproxyConfig(["server { listen 80; }"])).toBe(false);
    expect(detectHaproxyConfig(["frontend fe {"])).toBe(false);
    expect(detectHaproxyConfig(["    frontend fe"])).toBe(false);
    expect(detectHaproxyConfig(["frontend"])).toBe(false);
  });

  it("does not treat log, user, or a prose server line as confirmation", () => {
    expect(detectHaproxyConfig(["global", "    log stdout format raw local0"])).toBe(false);
    expect(detectHaproxyConfig(["global", "    user haproxy"])).toBe(false);
    expect(detectHaproxyConfig(["listen web", "    server app is down"])).toBe(false);
  });

  it("accepts a listen section when server has a name and an address", () => {
    expect(detectHaproxyConfig(["listen web", "    server app 127.0.0.1:8080"])).toBe(true);
    expect(detectHaproxyConfig(["listen web", "    server app localhost"])).toBe(true);
    expect(detectHaproxyConfig(["listen stats", "    server app 8080"])).toBe(true);
  });

  it("accepts tune and ssl-default directives, or a later section, as confirmation", () => {
    expect(detectHaproxyConfig(["global", "    tune.bufsize 16384"])).toBe(true);
    expect(detectHaproxyConfig(["global", "    ssl-default-bind-ciphers DEFAULT"])).toBe(true);
    expect(detectHaproxyConfig(["global", "frontend fe"])).toBe(true);
  });

  it("rejects malformed section arguments and weak confirmation lines", () => {
    expect(detectHaproxyConfig(["defaults from"])).toBe(false);
    expect(detectHaproxyConfig(["defaults web extra"])).toBe(false);
    expect(detectHaproxyConfig(["defaults from name extra"])).toBe(false);
    expect(detectHaproxyConfig(["defaults web via base"])).toBe(false);
    expect(detectHaproxyConfig(["defaults a b c d"])).toBe(false);
    expect(detectHaproxyConfig(["frontend from"])).toBe(false);
    expect(detectHaproxyConfig(["listen web extra"])).toBe(false);
    expect(detectHaproxyConfig(["global", "    mode"])).toBe(false);
    expect(detectHaproxyConfig(["global", "    mode foo"])).toBe(false);
    expect(detectHaproxyConfig(["listen web", "    server app"])).toBe(false);
    expect(detectHaproxyConfig(["global", "    maxconn 1 {"])).toBe(false);
    expect(detectHaproxyConfig(["global", "maxconn 2000"])).toBe(false);
  });

  it("stops scanning comments before the first section", () => {
    const comments = Array.from({ length: 200 }, () => "# comment");
    expect(detectHaproxyConfig([...comments, "frontend fe"])).toBe(false);
    expect(detectHaproxyConfig([...comments.slice(0, 5), "frontend fe"])).toBe(true);
  });

  it("stops looking for a witness after 40 non-comment lines", () => {
    const filler = Array.from({ length: 40 }, () => "    noise");
    expect(detectHaproxyConfig(["global", ...filler, "    maxconn 1"])).toBe(false);
    expect(detectHaproxyConfig(["global", ...filler.slice(0, 39), "    maxconn 1"])).toBe(true);
  });
});
