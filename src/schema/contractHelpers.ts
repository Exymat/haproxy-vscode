export function metadataContractError(path: string): Error {
  return new Error(`HAProxy schema is missing required generated metadata: ${path}`);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function assertRecordShape(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw metadataContractError(path);
  }
  return value;
}

export function stringArrayValue(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw metadataContractError(path);
  }
  return value as string[];
}

export function assertStringValue(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") {
    throw metadataContractError(path);
  }
}

export function assertOptionalStringValue(value: unknown, path: string): void {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw metadataContractError(path);
  }
}

export function assertOptionalStringArrayValue(value: unknown, path: string): void {
  if (value !== undefined) {
    stringArrayValue(value, path);
  }
}

export function assertOptionalNumberValue(value: unknown, path: string): void {
  if (value !== undefined && value !== null && typeof value !== "number") {
    throw metadataContractError(path);
  }
}

export function assertOptionalBooleanValue(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw metadataContractError(path);
  }
}

export function assertOptionalBooleanArrayValue(value: unknown, path: string): void {
  if (
    value !== undefined &&
    (!Array.isArray(value) || value.some((item) => typeof item !== "boolean"))
  ) {
    throw metadataContractError(path);
  }
}

export function assertStringArrayRecord(value: unknown, path: string): void {
  const record = assertRecordShape(value, path);
  for (const [key, item] of Object.entries(record)) {
    stringArrayValue(item, `${path}.${key}`);
  }
}

export function assertNestedStringArrayRecord(value: unknown, path: string): void {
  const record = assertRecordShape(value, path);
  for (const [key, item] of Object.entries(record)) {
    assertStringArrayRecord(item, `${path}.${key}`);
  }
}

export function assertBooleanMatrixValue(value: unknown, path: string): void {
  if (!Array.isArray(value)) {
    throw metadataContractError(path);
  }
  value.forEach((row, rowIndex) => {
    if (!Array.isArray(row) || row.some((item) => typeof item !== "boolean")) {
      throw metadataContractError(`${path}.${rowIndex}`);
    }
  });
}

export function recordValue(
  data: Record<string, unknown>,
  key: string,
  namespace: string,
): Record<string, unknown> {
  const value = data[key];
  return assertRecordShape(value, `${namespace}.${key}`);
}

export function stringMapValue(
  data: Record<string, unknown>,
  key: string,
  namespace: string,
): Record<string, string> {
  const record = recordValue(data, key, namespace);
  if (Object.values(record).some((value) => typeof value !== "string")) {
    throw metadataContractError(`${namespace}.${key}`);
  }
  return record as Record<string, string>;
}
