import {
  findEnvSampleFetchReferences,
  findEnvironmentVariableReferences,
  findQuotedEnvironmentExpansions,
  isEnvironmentVariableName,
} from "../../../src/environmentVariables";

function token(text: string, start = 0) {
  return { text, start, end: start + text.length } as never;
}

describe("environmentVariables", () => {
  it("validates HAProxy environment variable names", () => {
    expect(isEnvironmentVariableName("FOO")).toBe(true);
    expect(isEnvironmentVariableName("_FOO_1")).toBe(true);
    expect(isEnvironmentVariableName("1FOO")).toBe(false);
    expect(isEnvironmentVariableName("FOO-BAR")).toBe(false);
  });

  it("finds quoted shell-style expansions and skips malformed forms", () => {
    const hits = findQuotedEnvironmentExpansions(
      token('prefix "$FOO ${BAR} ${LIST[*]} ${BAZ-default} \\$SKIP $1BAD ${} ${OPEN-default"', 10),
    );

    expect(hits.map((hit) => hit.name)).toEqual(["FOO", "BAR", "LIST", "BAZ"]);
  });

  it("finds env() sample fetch references and skips malformed calls", () => {
    const hits = findEnvSampleFetchReferences(
      token("prefixenv(IGNORED) env( ) env(FOO missing) env( BAR ) env(  BAZ  )", 4),
    );

    expect(hits.map((hit) => hit.name)).toEqual(["BAR", "BAZ"]);
  });

  it("combines quoted and sample-fetch references", () => {
    expect(
      findEnvironmentVariableReferences(token('"$FOO" env(BAR)')).map((hit) => hit.name),
    ).toEqual(["FOO", "BAR"]);
  });
});
