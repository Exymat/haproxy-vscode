import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { hapeeSchemaAvailable, schemaArtifactId } from "../../../src/extension/version";
import { loadHapeeBundle, loadSchemaBundle } from "../../helpers/schema";

describe("hapee schema artifacts", () => {
  it("maps HAPEE LTS versions to r1 artifacts and ignores 3.4", () => {
    expect(hapeeSchemaAvailable("3.2")).toBe(true);
    expect(hapeeSchemaAvailable("3.4")).toBe(false);
    expect(schemaArtifactId("3.2", "hapee")).toBe("3.2r1");
    expect(schemaArtifactId("3.4", "hapee")).toBe("3.4");
    expect(schemaArtifactId("3.2", "community")).toBe("3.2");
  });

  it("ships a full 3.2r1 schema with HAPEE-only keywords", () => {
    const community = loadSchemaBundle("3.2");
    const { schema, languageData } = loadHapeeBundle("3.2");
    expect("module-load" in community.schema.keywords).toBe(false);
    expect(schema.keywords["module-load"]?.name).toBe("module-load");
    expect(schema.sections.global.keywords).toContain("module-load");
    expect(schema.keywords["module-path"]?.name).toBe("module-path");
    expect(languageData.keywords["module-load"]?.docsUrl).toContain("3-2r1");
    expect(schema.sample_converters?.has_ctl).toBeDefined();
    const schemaPath = join(__dirname, "..", "..", "..", "schemas", "haproxy-3.2r1.schema.json");
    expect(existsSync(schemaPath)).toBe(true);
  });

  it.each(["2.6", "2.8", "3.0", "3.2"] as const)(
    "keeps the complete %s community schema as an Enterprise subset",
    (version) => {
      const community = loadSchemaBundle(version).schema;
      const enterprise = loadHapeeBundle(version).schema;
      expect(Object.keys(enterprise.keywords)).toEqual(
        expect.arrayContaining(Object.keys(community.keywords)),
      );
      for (const [section, item] of Object.entries(community.sections)) {
        expect(enterprise.sections[section]?.keywords).toEqual(
          expect.arrayContaining(item.keywords),
        );
      }
      for (const [group, names] of Object.entries(community.keyword_groups)) {
        expect(enterprise.keyword_groups[group] ?? []).toEqual(expect.arrayContaining(names));
      }
      for (const group of ["sample_fetches", "sample_converters"] as const) {
        expect(Object.keys(enterprise[group] ?? {})).toEqual(
          expect.arrayContaining(Object.keys(community[group] ?? {})),
        );
        expect(
          Object.keys(enterprise[group] ?? {}).every(
            (name) => name.trim() === name && !/\s/.test(name),
          ),
        ).toBe(true);
      }
    },
  );

  it("ships explicit optional-module syntax in the HAPEE schema", () => {
    const { schema, languageData } = loadHapeeBundle("3.2");
    expect(schema.sections["udp-lb"]?.keywords).toContain("dgram-bind");
    expect(schema.sections["oidc-sso"]?.keywords).toContain("client-id");
    expect(schema.keyword_groups.http_request_actions).toContain("oidc-sso");
    expect(schema.keyword_groups.http_response_actions).toContain("oidc-sso");
    expect(schema.sections.global.keywords).toContain("saml-sso-load");
    expect(schema.keyword_groups.http_after_response_actions).toContain("saml-sso");
    expect(schema.sections.captcha?.keywords).toEqual(
      expect.arrayContaining(["on-error", "site-key"]),
    );
    expect(schema.sections["botmgmt-profile"]?.keywords).toContain("track-defaults");
    expect(schema.sections["waf-profile"]?.keywords).toContain("rules-file");
    expect(schema.sections["rhi-bgp"]?.keywords).toContain("rhi-announce");
    expect(schema.keyword_groups.http_request_actions).toEqual(
      expect.arrayContaining(["botmgmt-evaluate", "waf-evaluate"]),
    );
    expect(schema.keyword_groups.filters).toEqual(
      expect.arrayContaining(["htmldom", "botmgmt", "waf"]),
    );
    expect(languageData.keywords["oidc-sso-dir"]?.docsUrl).toContain(
      "/enterprise-modules/single-sign-on/sso-openid-connect/",
    );
    expect(languageData.groups.filters.find((item) => item.name === "htmldom")?.docsUrl).toContain(
      "/enterprise-modules/response-body-injection/",
    );
  });

  it("keeps community TextMate grammars on OSS names and keywords", () => {
    for (const version of ["2.6", "2.8", "3.0", "3.2", "3.4"] as const) {
      const grammarPath = join(
        __dirname,
        "..",
        "..",
        "..",
        "syntaxes",
        `haproxy-${version}.tmLanguage.json`,
      );
      const grammarText = readFileSync(grammarPath, "utf8");
      const grammar = JSON.parse(grammarText) as { name: string };
      expect(grammar.name).toBe(`HAProxy ${version}`);
      expect(grammarText).not.toContain("module\\\\-load");
      expect(grammarText).not.toContain("saml\\\\-sso");
      expect(grammarText).not.toContain("oidc\\\\-sso");
      expect(grammarText).not.toContain("rhi\\\\-announce");
    }
  });

  it("ships HAPEE TextMate grammars next to the r1 schemas", () => {
    for (const version of ["2.6", "2.8", "3.0", "3.2"] as const) {
      const grammarPath = join(
        __dirname,
        "..",
        "..",
        "..",
        "syntaxes",
        `haproxy-${version}r1.tmLanguage.json`,
      );
      expect(existsSync(grammarPath)).toBe(true);
      const grammarText = readFileSync(grammarPath, "utf8");
      const grammar = JSON.parse(grammarText) as { name: string };
      expect(grammar.name).toBe(`HAProxy ${version}r1`);
      expect(grammarText).toContain("module\\\\-load");
    }

    const grammar = readFileSync(
      join(__dirname, "..", "..", "..", "syntaxes", "haproxy-3.2r1.tmLanguage.json"),
      "utf8",
    );
    expect(grammar).toContain("module\\\\-load");
    expect(grammar).toContain("oidc\\\\-sso");
    expect(grammar).toContain("saml\\\\-sso");
    expect(grammar).toContain("rhi\\\\-announce");

    const grammar30 = readFileSync(
      join(__dirname, "..", "..", "..", "syntaxes", "haproxy-3.0r1.tmLanguage.json"),
      "utf8",
    );
    expect(grammar30).toContain("saml\\\\-sso");
    expect(grammar30).not.toContain("oidc\\\\-sso");
    expect(grammar30).not.toContain("rhi\\\\-announce");

    for (const version of ["2.6", "2.8"] as const) {
      const earlierGrammar = readFileSync(
        join(__dirname, "..", "..", "..", "syntaxes", `haproxy-${version}r1.tmLanguage.json`),
        "utf8",
      );
      expect(earlierGrammar).not.toContain("saml\\\\-sso");
      expect(earlierGrammar).not.toContain("oidc\\\\-sso");
      expect(earlierGrammar).not.toContain("rhi\\\\-announce");
    }
  });
});
