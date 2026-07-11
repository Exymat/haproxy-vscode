import { describe, expect, it } from "vitest";

import { LanguageKeyword } from "../../../src/language/languageData";
import {
  languageVariantForSection,
  resolveLanguageKeyword,
  resolveSchemaKeyword,
  schemaVariantForSection,
} from "../../../src/language/keywordVariant";
import { SchemaKeyword } from "../../../src/schema/types";

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

  it("falls back to base sections, signatures, and contexts when a variant leaves them empty", () => {
    const keyword: LanguageKeyword = {
      name: "inherit",
      sections: ["frontend"],
      signatures: ["inherit <value>"],
      description: "base description",
      docsUrl: "http://example.com/base",
      arguments: [{ parameter: "value", description: "base arg", values: [] }],
      variants: [
        {
          chapter: "4.2",
          sections: [],
          signatures: [],
          description: "variant description",
          docsUrl: "http://example.com/variant",
          contexts: [],
          arguments: [{ parameter: "value", description: "", values: [] }],
        },
      ],
    };

    const resolved = resolveLanguageKeyword(keyword, "frontend");
    expect(resolved?.sections).toEqual(["frontend"]);
    expect(resolved?.signatures).toEqual(["inherit <value>"]);
    expect(resolved?.arguments?.[0]?.description).toBe("base arg");
  });

  it("returns the sole variant when section does not match and only one variant exists", () => {
    const schemaKeyword: SchemaKeyword = {
      name: "single",
      sections: ["frontend"],
      signatures: ["single"],
      sources: [],
      variants: [
        {
          chapter: "9.1",
          sections: ["backend"],
          signatures: ["single backend"],
        },
      ],
    };

    expect(schemaVariantForSection(schemaKeyword, "frontend")?.chapter).toBe("9.1");
    expect(resolveSchemaKeyword(schemaKeyword, "frontend")?.signatures).toEqual(["single backend"]);
  });

  it("falls back to base schema signatures, contexts, and arguments when a variant omits them", () => {
    const schemaKeyword: SchemaKeyword = {
      name: "inherit-schema",
      sections: ["backend"],
      signatures: ["inherit-schema <value>"],
      sources: ["docs"],
      contexts: ["tcp"],
      arguments: [{ parameter: "value", description: "base arg", values: [] }],
      variants: [
        {
          chapter: "4.2",
          sections: [],
          signatures: [],
          contexts: [],
          arguments: [{ parameter: "value", description: "", values: [] }],
        },
      ],
    };

    const resolved = resolveSchemaKeyword(schemaKeyword, "backend");
    expect(resolved?.sections).toEqual(["backend"]);
    expect(resolved?.signatures).toEqual(["inherit-schema <value>"]);
    expect(resolved?.contexts).toEqual(["tcp"]);
    expect(resolved?.arguments?.[0]?.description).toBe("base arg");
  });

  it("returns undefined for variant helpers when no variants exist", () => {
    const noVariantsLanguage: LanguageKeyword = {
      name: "plain",
      sections: ["frontend"],
      signatures: ["plain"],
      description: "plain",
      docsUrl: "http://example.com/plain",
    };
    const noVariantsSchema: SchemaKeyword = {
      name: "plain-schema",
      sections: ["backend"],
      signatures: ["plain-schema"],
      sources: [],
    };

    expect(languageVariantForSection(noVariantsLanguage, "frontend")).toBeUndefined();
    expect(schemaVariantForSection(noVariantsSchema, "backend")).toBeUndefined();
  });

  it("caches resolved keyword views by section", () => {
    const schemaKeyword: SchemaKeyword = {
      name: "cached-schema",
      sections: ["backend", "frontend"],
      signatures: ["cached-schema <value>"],
      sources: ["docs"],
      argument_model: { min_args: 1, max_args: 1, slots: [{ enum: ["one"] }] },
      variants: [
        {
          chapter: "4.2",
          sections: ["backend"],
          signatures: ["cached-schema backend <value>"],
          argument_model: { min_args: 1, max_args: 1, slots: [{ enum: ["backend"] }] },
        },
      ],
    };
    const languageKeyword: LanguageKeyword = {
      name: "cached-language",
      sections: ["frontend", "backend"],
      signatures: ["cached-language <value>"],
      description: "base",
      docsUrl: "http://example.com/base",
      variants: [
        {
          chapter: "4.2",
          sections: ["frontend"],
          signatures: ["cached-language frontend <value>"],
          description: "frontend",
          docsUrl: "http://example.com/frontend",
        },
      ],
    };

    expect(resolveSchemaKeyword(schemaKeyword, "backend")).toBe(
      resolveSchemaKeyword(schemaKeyword, "backend"),
    );
    expect(resolveSchemaKeyword(schemaKeyword, "frontend")).toBe(
      resolveSchemaKeyword(schemaKeyword, "frontend"),
    );
    expect(resolveSchemaKeyword(schemaKeyword, "backend")).not.toBe(
      resolveSchemaKeyword(schemaKeyword, "frontend"),
    );

    expect(resolveLanguageKeyword(languageKeyword, "frontend")).toBe(
      resolveLanguageKeyword(languageKeyword, "frontend"),
    );
    expect(resolveLanguageKeyword(languageKeyword, "backend")).toBe(
      resolveLanguageKeyword(languageKeyword, "backend"),
    );
    expect(resolveLanguageKeyword(languageKeyword, "frontend")).not.toBe(
      resolveLanguageKeyword(languageKeyword, "backend"),
    );
  });
});
