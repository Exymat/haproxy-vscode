import { describe, expect, it } from "vitest";

import { LanguageKeyword } from "../../src/languageData";
import {
  languageVariantForSection,
  resolveLanguageKeyword,
  resolveSchemaKeyword,
  schemaVariantForSection,
} from "../../src/keywordVariant";
import { SchemaKeyword } from "../../src/schema";

describe("resolveLanguageKeyword", () => {
  const bind: LanguageKeyword = {
    name: "bind",
    sections: ["frontend", "listen", "peers", "log-forward"],
    signatures: ["bind <addr> [param*]", "bind [<address>]:port [param*]"],
    description: "Define one or several listening addresses and/or ports in a frontend.",
    docsUrl: "https://docs.haproxy.org/3.0/configuration.html#4.2-bind",
    variants: [
      {
        chapter: "4.2",
        sections: ["frontend", "listen"],
        signatures: ["bind [<address>]:<port_range> [, ...] [param*]"],
        description: "Define one or several listening addresses and/or ports in a frontend.",
        docsUrl: "https://docs.haproxy.org/3.0/configuration.html#4.2-bind",
      },
      {
        chapter: "3.5",
        sections: ["peers"],
        signatures: ["bind [<address>]:port [param*]"],
        description: "Defines the binding parameters of the local peer of this peers section.",
        docsUrl: "https://docs.haproxy.org/3.0/configuration.html#3.5-bind",
      },
      {
        chapter: "3.10",
        sections: ["log-forward"],
        signatures: ["bind <addr> [param*]"],
        description: "Used to configure a stream log listener to receive messages to forward.",
        docsUrl: "https://docs.haproxy.org/3.0/configuration.html#3.10-bind",
      },
    ],
  };

  it("picks the peers variant inside a peers section", () => {
    const resolved = resolveLanguageKeyword(bind, "peers");
    expect(resolved?.description.toLowerCase()).toContain("peer");
    expect(resolved?.docsUrl).toContain("#3.5-bind");
    expect(resolved?.sections).toEqual(["peers"]);
  });

  it("picks the log-forward variant inside a log-forward section", () => {
    const resolved = resolveLanguageKeyword(bind, "log-forward");
    expect(resolved?.description.toLowerCase()).toContain("log listener");
    expect(resolved?.docsUrl).toContain("#3.10-bind");
    expect(resolved?.sections).toEqual(["log-forward"]);
  });

  it("picks the proxy variant inside a frontend section", () => {
    const resolved = resolveLanguageKeyword(bind, "frontend");
    expect(resolved?.description.toLowerCase()).toContain("frontend");
    expect(resolved?.docsUrl).toContain("#4.2-bind");
    expect(resolved?.sections).toEqual(["frontend", "listen"]);
  });

  it("returns undefined for missing keywords", () => {
    expect(resolveLanguageKeyword(undefined, "frontend")).toBeUndefined();
    expect(resolveSchemaKeyword(undefined, "frontend")).toBeUndefined();
  });

  it("prefers the narrowest section match when multiple variants overlap", () => {
    const keyword: LanguageKeyword = {
      name: "overlap",
      sections: ["defaults"],
      signatures: ["overlap"],
      description: "base",
      docsUrl: "http://example.com/base",
      variants: [
        {
          chapter: "1",
          sections: ["defaults", "frontend"],
          signatures: ["overlap wide"],
          description: "wide variant",
          docsUrl: "http://example.com/wide",
        },
        {
          chapter: "2",
          sections: ["defaults"],
          signatures: ["overlap narrow"],
          description: "narrow variant",
          docsUrl: "http://example.com/narrow",
        },
      ],
    };
    const resolved = resolveLanguageKeyword(keyword, "defaults");
    expect(resolved?.description).toBe("narrow variant");
    expect(resolved?.signatures).toEqual(["overlap narrow"]);
  });

  it("falls back to chapter preference when section is ambiguous", () => {
    const resolved = resolveLanguageKeyword(bind, null);
    expect(resolved?.docsUrl).toContain("#4.2-bind");
  });

  it("falls back to the first variant when no preferred chapter matches", () => {
    const keyword: LanguageKeyword = {
      name: "fallback",
      sections: ["defaults"],
      signatures: ["fallback"],
      description: "base",
      docsUrl: "http://example.com/base",
      variants: [
        {
          chapter: "9.8",
          sections: ["backend"],
          signatures: ["fallback backend"],
          description: "backend variant",
          docsUrl: "http://example.com/backend",
        },
        {
          chapter: "9.9",
          sections: ["listen"],
          signatures: ["fallback listen"],
          description: "listen variant",
          docsUrl: "http://example.com/listen",
        },
      ],
    };
    const resolved = resolveLanguageKeyword(keyword, "defaults");
    expect(resolved?.description).toBe("backend variant");
    expect(languageVariantForSection(keyword, "defaults")?.chapter).toBe("9.8");
  });

  it("returns base keyword data when no variant applies", () => {
    const keyword: LanguageKeyword = {
      name: "plain",
      sections: ["global"],
      signatures: ["plain"],
      description: "plain description",
      docsUrl: "http://example.com/plain",
    };
    const resolved = resolveLanguageKeyword(keyword, "global");
    expect(resolved?.description).toBe("plain description");
    expect(resolved?.docsUrl).toBe("http://example.com/plain");
  });

  it("exposes section-specific language and schema variants", () => {
    expect(languageVariantForSection(bind, "peers")?.chapter).toBe("3.5");
    expect(languageVariantForSection(bind, "frontend")?.chapter).toBe("4.2");

    const schemaKeyword: SchemaKeyword = {
      name: "balance",
      sections: ["defaults", "backend"],
      signatures: ["balance <algorithm>"],
      sources: ["defaults"],
      argument_model: {
        min_args: 1,
        max_args: 2,
        slots: [{ enum: ["roundrobin"] }],
      },
      variants: [
        {
          chapter: "9.8",
          sections: ["backend"],
          signatures: ["balance <algorithm> [ <arguments> ]"],
          argument_model: {
            min_args: 1,
            max_args: 3,
            slots: [{ enum: ["roundrobin"] }, { enum: [], optional: true }],
          },
        },
        {
          chapter: "9.9",
          sections: ["listen"],
          signatures: ["balance listen"],
          argument_model: {
            min_args: 1,
            max_args: 4,
            slots: [{ enum: ["roundrobin"] }],
          },
        },
      ],
    };
    expect(schemaVariantForSection(schemaKeyword, "backend")?.chapter).toBe("9.8");
    expect(resolveSchemaKeyword(schemaKeyword, "backend")?.argument_model?.max_args).toBe(3);

    const baseOnly: SchemaKeyword = {
      name: "plain-schema",
      sections: ["defaults"],
      signatures: ["plain-schema"],
      sources: [],
      argument_model: { min_args: 0, max_args: 2, slots: [] },
    };
    expect(resolveSchemaKeyword(baseOnly, "defaults")?.argument_model?.max_args).toBe(2);
  });
});
