import { parse as parseYaml } from "yaml";
import type {
  AuthType,
  BodySchema,
  DiscoveredEndpoint,
  HeaderDef,
  HttpMethod,
  ParamDef,
  ParamType,
} from "@/lib/db/types";
import {
  absoluteEndpointUrl,
  categoryDisplayName,
  categorySlugFor,
  normalizeMethod,
  pathParamsFromPath,
} from "@/lib/discovery/normalize";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

type Json = Record<string, unknown>;

export interface ParsedOpenApi {
  title: string;
  version: string;
  baseUrl: string;
  endpoints: DiscoveredEndpoint[];
  warnings: string[];
}

function isObject(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function decodePointer(segment: string): string {
  return decodeURIComponent(segment).replace(/~1/g, "/").replace(/~0/g, "~");
}

export function resolveRef(doc: Json, ref: unknown): unknown {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return undefined;
  let current: unknown = doc;
  for (const rawSegment of ref.slice(2).split("/")) {
    if (!isObject(current)) return undefined;
    current = current[decodePointer(rawSegment)];
  }
  return current;
}

function deref(doc: Json, value: unknown, depth = 0): unknown {
  if (depth > 8 || !isObject(value)) return value;
  if (typeof value.$ref === "string") {
    const resolved = resolveRef(doc, value.$ref);
    return resolved === undefined ? value : deref(doc, resolved, depth + 1);
  }
  return value;
}

function resolveBaseUrl(doc: Json, fallbackUrl?: string): string {
  const servers = Array.isArray(doc.servers) ? doc.servers : [];
  const first = servers.find((server) => isObject(server) && typeof server.url === "string") as
    | { url?: string; variables?: Record<string, { default?: string }> }
    | undefined;

  let raw = first?.url?.trim();
  if (raw && first?.variables) {
    for (const [name, variable] of Object.entries(first.variables)) {
      raw = raw?.replace(new RegExp(`\\{${name}\\}`, "g"), variable?.default ?? "");
    }
  }

  if (!raw) {
    if (typeof doc.host === "string") {
      const schemes = Array.isArray(doc.schemes) ? doc.schemes : ["https"];
      const scheme = typeof schemes[0] === "string" ? schemes[0] : "https";
      const basePath = typeof doc.basePath === "string" ? doc.basePath : "";
      raw = `${scheme}://${doc.host}${basePath}`;
    } else if (fallbackUrl) {
      const origin = new URL(fallbackUrl).origin;
      raw = origin;
    } else {
      raw = "";
    }
  }

  let resolved = raw || "";
  if (fallbackUrl) {
    try {
      resolved = new URL(resolved || "/", fallbackUrl).toString();
    } catch {
      resolved = raw || "";
    }
  }
  return resolved.replace(/\/+$/, "");
}

function schemaType(schema: unknown): ParamType {
  if (!isObject(schema)) return "string";
  const raw = typeof schema.type === "string" ? schema.type : undefined;
  if (raw === "integer" || raw === "number" || raw === "boolean") return raw;
  if (Array.isArray(schema.enum) || schema.enum) return "enum";
  return "string";
}

function exampleFromSchema(schema: unknown): string | undefined {
  if (!isObject(schema)) return undefined;
  if (schema.example !== undefined) return String(schema.example);
  if (schema.default !== undefined) return String(schema.default);
  if (Array.isArray(schema.enum) && schema.enum.length) return String(schema.enum[0]);
  return undefined;
}

function paramFromSpec(doc: Json, raw: unknown): (ParamDef & { location: string }) | null {
  const param = deref(doc, raw);
  if (!isObject(param) || typeof param.name !== "string") return null;
  const location = typeof param.in === "string" ? param.in : "query";
  const schema = deref(doc, param.schema);
  const type = schemaType(schema);
  const paramDef: ParamDef & { location: string } = {
    name: param.name,
    type,
    required: param.required === true,
    location,
  };
  if (typeof param.description === "string") paramDef.description = param.description.slice(0, 500);
  const example = exampleFromSchema(schema) ?? (param.example !== undefined ? String(param.example) : undefined);
  if (example !== undefined) paramDef.example = example;
  const def = isObject(schema) ? schema.default : undefined;
  if (def !== undefined) paramDef.default = String(def);
  if (isObject(schema) && Array.isArray(schema.enum)) {
    paramDef.enum = schema.enum.map(String).slice(0, 50);
  }
  return paramDef;
}

function buildBodySchema(doc: Json, requestBody: unknown): {
  bodySchema: BodySchema | null;
  contentType: string | null;
  example: unknown;
  isStreaming: boolean;
} {
  const body = deref(doc, requestBody);
  if (!isObject(body) || !isObject(body.content)) {
    return { bodySchema: null, contentType: null, example: undefined, isStreaming: false };
  }
  const content = body.content as Json;
  const preferred = ["application/json", "application/x-www-form-urlencoded", "*/*"].find(
    (type) => content[type],
  );
  if (!preferred) {
    return { bodySchema: null, contentType: null, example: undefined, isStreaming: false };
  }
  const media = isObject(content[preferred]) ? (content[preferred] as Json) : {};
  const rawSchema = deref(doc, media.schema);
  const schema = isObject(rawSchema) ? rawSchema : {};
  const properties = isObject(schema.properties) ? (schema.properties as Json) : {};

  const bodyProperties: NonNullable<BodySchema["properties"]> = {};
  for (const [key, rawProperty] of Object.entries(properties)) {
    const property = isObject(deref(doc, rawProperty)) ? (deref(doc, rawProperty) as Json) : {};
    bodyProperties[key] = {
      type: typeof property.type === "string" ? property.type : "string",
      description: typeof property.description === "string" ? property.description : undefined,
      example: property.example ?? property.default,
    };
  }

  const example = media.example ?? schema.example;

  return {
    bodySchema: {
      type: "object",
      properties: bodyProperties,
      required: Array.isArray(schema.required) ? schema.required.map(String) : [],
      example,
    },
    contentType: preferred === "*/*" ? "application/json" : preferred,
    example,
    isStreaming: false,
  };
}

function pickExampleResponse(doc: Json, operation: Json): unknown {
  const responses = isObject(operation.responses) ? (operation.responses as Json) : {};
  const codes = Object.keys(responses).sort((a, b) => {
    const score = (code: string) => (code.startsWith("2") ? 0 : code === "default" ? 2 : 1);
    return score(a) - score(b) || a.localeCompare(b);
  });
  for (const code of codes) {
    const response = deref(doc, responses[code]);
    if (!isObject(response) || !isObject(response.content)) continue;
    const content = response.content as Json;
    const jsonType = Object.keys(content).find((type) => type.includes("json"));
    if (!jsonType) continue;
    const media = isObject(content[jsonType]) ? (content[jsonType] as Json) : {};
    if (media.example !== undefined) return media.example;
    const schema = deref(doc, media.schema);
    if (isObject(schema) && schema.example !== undefined) return schema.example;
  }
  return undefined;
}

function authFromSpec(doc: Json, operation: Json): {
  authType: AuthType;
  authMeta: Record<string, unknown>;
} {
  const security = Array.isArray(operation.security)
    ? operation.security
    : Array.isArray(doc.security)
      ? doc.security
      : [];
  const first = security.find(isObject) as Json | undefined;
  if (!first) return { authType: "none", authMeta: {} };
  const schemeName = Object.keys(first)[0];
  const schemes = isObject(doc.components)
    ? (doc.components.securitySchemes as Json | undefined)
    : (doc.securityDefinitions as Json | undefined);
  const rawScheme = schemes && schemeName ? schemes[schemeName] : undefined;
  const scheme = isObject(deref(doc, rawScheme)) ? (deref(doc, rawScheme) as Json) : null;
  if (!scheme) return { authType: "none", authMeta: { security_scheme: schemeName } };

  if (scheme.type === "http" && scheme.scheme === "bearer") {
    return { authType: "bearer", authMeta: { discovered_from: "openapi_security" } };
  }
  if (scheme.type === "http" && scheme.scheme === "basic") {
    return { authType: "basic", authMeta: { discovered_from: "openapi_security" } };
  }
  if (scheme.type === "apiKey" && scheme.in === "header" && typeof scheme.name === "string") {
    return {
      authType: "api_key",
      authMeta: { header_name: scheme.name, discovered_from: "openapi_security" },
    };
  }
  return {
    authType: "none",
    authMeta: {
      discovered_from: "openapi_security",
      unsupported_auth_scheme: schemeName,
      note: "This security scheme is not natively supported. Configure credentials manually if needed.",
    },
  };
}

export function parseOpenApiDocument(
  input: string | Record<string, unknown>,
  options: { sourceUrl?: string; providerSlug?: string } = {},
): ParsedOpenApi {
  let doc: Json;
  if (typeof input === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      try {
        parsed = parseYaml(input);
      } catch {
        throw new Error("The document is neither valid JSON nor valid YAML.");
      }
    }
    if (!isObject(parsed)) throw new Error("The OpenAPI document must be an object.");
    doc = parsed;
  } else {
    doc = input;
  }

  const isOpenApi3 = typeof doc.openapi === "string" && doc.openapi.startsWith("3");
  const isSwagger2 = typeof doc.swagger === "string" && doc.swagger.startsWith("2");
  if (!isOpenApi3 && !isSwagger2) {
    throw new Error(
      "Unsupported specification. Anvex supports OpenAPI 3.x and Swagger 2.0 documents.",
    );
  }

  const warnings: string[] = [];
  const baseUrl = resolveBaseUrl(doc, options.sourceUrl);
  if (!baseUrl) {
    throw new Error(
      "The specification does not define a server URL. Provide a document URL so a base URL can be inferred, or add the base URL after import.",
    );
  }

  const providerSlug = options.providerSlug ?? "openapi";
  const title = isObject(doc.info) && typeof doc.info.title === "string" ? doc.info.title : "Imported API";
  const version = isObject(doc.info) && typeof doc.info.version === "string" ? doc.info.version : "unknown";
  const paths = isObject(doc.paths) ? (doc.paths as Json) : {};
  const endpoints: DiscoveredEndpoint[] = [];

  for (const [path, rawPathItem] of Object.entries(paths)) {
    const pathItem = deref(doc, rawPathItem);
    if (!isObject(pathItem)) continue;
    if (!path.startsWith("/")) {
      warnings.push(`Skipped non-relative path "${path}".`);
      continue;
    }

    for (const method of METHODS) {
      const operation = pathItem[method.toLowerCase()];
      if (!isObject(operation)) continue;

      const tag = Array.isArray(operation.tags) && typeof operation.tags[0] === "string"
        ? operation.tags[0]
        : "general";
      const categorySlug = categorySlugFor(tag);
      const operationId =
        typeof operation.operationId === "string" ? operation.operationId : undefined;
      const summary =
        (typeof operation.summary === "string" && operation.summary) ||
        (typeof operation.description === "string" && operation.description.split("\n")[0]) ||
        operationId ||
        `${method} ${path}`;

      const queryParams: ParamDef[] = [];
      const pathParams: ParamDef[] = [];
      const headersSchema: HeaderDef[] = [];

      const rawParams = [
        ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
        ...(Array.isArray(operation.parameters) ? operation.parameters : []),
      ];
      for (const rawParam of rawParams) {
        const param = paramFromSpec(doc, rawParam);
        if (!param) continue;
        const { location, ...def } = param;
        if (location === "query") queryParams.push(def);
        else if (location === "path") pathParams.push(def);
        else if (location === "header") {
          headersSchema.push({
            name: def.name,
            required: def.required,
            description: def.description,
            example: def.example,
          });
        }
      }

      const declaredPathParams = pathParamsFromPath(path);
      for (const declared of declaredPathParams) {
        if (!pathParams.some((param) => param.name === declared.name)) {
          pathParams.push(declared);
        }
      }

      const body = buildBodySchema(doc, operation.requestBody);
      const auth = authFromSpec(doc, operation);
      const responseExample = pickExampleResponse(doc, operation);
      const requestExample: Record<string, unknown> = {
        method,
        path,
        ...(queryParams.length
          ? {
              query: Object.fromEntries(
                queryParams.map((param) => [param.name, param.example ?? param.default ?? `<${param.name}>`]),
              ),
            }
          : {}),
        ...(body.example !== undefined ? { body: body.example } : {}),
      };

      const operationServers = Array.isArray(operation.servers) ? operation.servers : [];
      const operationBase =
        operationServers.length && isObject(operationServers[0]) &&
        typeof (operationServers[0] as Json).url === "string"
          ? String((operationServers[0] as Json).url)
          : baseUrl;

      endpoints.push({
        name: summary.slice(0, 160),
        path,
        method,
        description:
          (typeof operation.description === "string" && operation.description.slice(0, 1900)) ||
          summary.slice(0, 1900),
        categorySlug,
        categoryName: categoryDisplayName(categorySlug),
        baseUrl: operationBase,
        queryParams,
        pathParams,
        headersSchema,
        bodySchema: body.bodySchema,
        contentType: body.contentType ?? "application/json",
        authType: auth.authType,
        authMeta: auth.authMeta,
        requestExample,
        responseExample: responseExample ?? null,
        isNsfw: categorySlug === "nsfw",
        supportsStreaming: Boolean(
          (isObject(operation.requestBody) &&
            isObject((operation.requestBody as Json).content) &&
            "text/event-stream" in ((operation.requestBody as Json).content as Json)) ||
            (isObject(operation.responses) &&
              JSON.stringify(operation.responses).includes("text/event-stream")),
        ),
        sourceUrl: options.sourceUrl ?? absoluteEndpointUrl(baseUrl, path),
        sourceKey: `${providerSlug}:${method}:${path}`,
        metadata: {
          spec: isOpenApi3 ? "openapi3" : "swagger2",
          spec_version: isOpenApi3 ? doc.openapi : doc.swagger,
          operation_id: operationId,
          tag,
          base_url: operationBase,
          deprecated: operation.deprecated === true,
          discovered_at: new Date().toISOString(),
          source_document: options.sourceUrl ?? null,
          security: auth.authMeta,
          request_body_content_type: body.contentType,
        },
      });
    }
  }

  if (!endpoints.length) {
    throw new Error("No GET/POST/PUT/PATCH/DELETE operations were found in the specification.");
  }

  return { title, version, baseUrl, endpoints, warnings };
}
