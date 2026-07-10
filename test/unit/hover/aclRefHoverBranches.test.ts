import * as vscode from "vscode";
import { describe, expect, it } from "vitest";

import { tryAclRefHover } from "../../../src/hover/handlers/aclRefHover";
import type { DocumentContextWithToken } from "../../../src/hover/types";
import { getLineSemanticContext } from "../../../src/lineSemanticContext";
import { createDocument } from "../../helpers/document";
import { loadSchemaBundle } from "../../helpers/schema";

const bundle = loadSchemaBundle("3.4");

describe("ACL reference hover branch behavior", () => {
  it("uses semantic ACL reference groups from generated metadata", () => {
    const aclSchema = structuredClone(bundle.schema);
    aclSchema.semantic_groups = {
      ...aclSchema.semantic_groups,
      acl_ref_groups: ["acl_int_operators"],
    };
    const aclDoc = createDocument("frontend web\n    acl paths path EQ /etc/paths");
    const aclPosition = new vscode.Position(1, "    acl paths path ".length);
    const aclSemantic = getLineSemanticContext(aclDoc, aclPosition, aclSchema, bundle.languageData);
    if (!aclSemantic?.ctx.token) {
      throw new Error("expected acl flag token");
    }
    const aclCtx = aclSemantic.ctx as DocumentContextWithToken;

    expect(
      tryAclRefHover({
        document: aclDoc,
        position: aclPosition,
        data: bundle.languageData,
        schema: aclSchema,
        semantic: aclSemantic,
        ctx: aclCtx,
        range: new vscode.Range(1, aclCtx.token.start, 1, aclCtx.token.end),
        cursorOffset: aclPosition.character - aclCtx.token.start,
        tokenLower: aclCtx.token.text.toLowerCase(),
        analyzed: aclSemantic.analyzed,
      }),
    ).not.toBeNull();
  });

  it("uses exact-case ACL flag hovers without lowercase fallback", () => {
    const aclSchema = structuredClone(bundle.schema);
    aclSchema.semantic_groups = {
      ...aclSchema.semantic_groups,
      acl_ref_groups: ["acl_flags"],
    };

    const exactDoc = createDocument("frontend web\n    acl paths path -M /etc/paths");
    const exactPosition = new vscode.Position(1, "    acl paths path ".length);
    const exactSemantic = getLineSemanticContext(
      exactDoc,
      exactPosition,
      aclSchema,
      bundle.languageData,
    );
    if (!exactSemantic?.ctx.token) {
      throw new Error("expected exact ACL flag token");
    }
    expect(
      tryAclRefHover({
        document: exactDoc,
        position: exactPosition,
        data: bundle.languageData,
        schema: aclSchema,
        semantic: exactSemantic,
        ctx: exactSemantic.ctx as DocumentContextWithToken,
        range: new vscode.Range(1, exactSemantic.ctx.token.start, 1, exactSemantic.ctx.token.end),
        cursorOffset: exactPosition.character - exactSemantic.ctx.token.start,
        tokenLower: exactSemantic.ctx.token.text.toLowerCase(),
        analyzed: exactSemantic.analyzed,
      }),
    ).not.toBeNull();

    const lowerDoc = createDocument("frontend web\n    acl paths path -U /etc/paths");
    const lowerPosition = new vscode.Position(1, "    acl paths path ".length);
    const lowerSemantic = getLineSemanticContext(
      lowerDoc,
      lowerPosition,
      aclSchema,
      bundle.languageData,
    );
    if (!lowerSemantic?.ctx.token) {
      throw new Error("expected lowercase ACL flag token");
    }
    expect(
      tryAclRefHover({
        document: lowerDoc,
        position: lowerPosition,
        data: bundle.languageData,
        schema: aclSchema,
        semantic: lowerSemantic,
        ctx: lowerSemantic.ctx as DocumentContextWithToken,
        range: new vscode.Range(1, lowerSemantic.ctx.token.start, 1, lowerSemantic.ctx.token.end),
        cursorOffset: lowerPosition.character - lowerSemantic.ctx.token.start,
        tokenLower: lowerSemantic.ctx.token.text.toLowerCase(),
        analyzed: lowerSemantic.analyzed,
      }),
    ).toBeNull();
  });
});
