import { metadataContractError, stringArrayValue } from "./contractHelpers";
import type { HaproxySchema, SchemaAddressPolicy } from "./types";

export function schemaAddressPolicies(schema: HaproxySchema): Record<string, SchemaAddressPolicy> {
  if (!schema.address_policies || Object.keys(schema.address_policies).length === 0) {
    throw metadataContractError("address_policies");
  }
  return schema.address_policies;
}

export function schemaAddressPolicy(schema: HaproxySchema, name: string): SchemaAddressPolicy {
  const policy = schemaAddressPolicies(schema)[name];
  if (!policy) {
    throw metadataContractError(`address_policies.${name}`);
  }
  return policy;
}

export function schemaSampleTypes(schema: HaproxySchema): string[] {
  const types = stringArrayValue(schema.sample_types, "sample_types");
  if (types.length === 0) {
    throw metadataContractError("sample_types");
  }
  return types;
}

export function schemaSampleCasts(schema: HaproxySchema): boolean[][] {
  if (!Array.isArray(schema.sample_casts) || schema.sample_casts.length === 0) {
    throw metadataContractError("sample_casts");
  }
  return schema.sample_casts;
}
