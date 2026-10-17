import { z } from "zod";

const namePattern = /^[A-Za-z0-9_.-]{1,64}$/;
const slugPattern = /^[a-z0-9][a-z0-9-]{0,79}$/;

export const paramTypeSchema = z.enum(["string", "number", "integer", "boolean", "enum"]);

export const paramDefSchema = z.object({
  name: z.string().min(1).max(64).regex(namePattern, "Invalid parameter name"),
  type: paramTypeSchema.optional(),
  required: z.boolean().optional(),
  description: z.string().max(500).optional(),
  example: z.string().max(2048).optional(),
  default: z.string().max(2048).optional(),
  enum: z.array(z.string().max(256)).max(50).optional(),
});

export const headerDefSchema = z.object({
  name: z.string().min(1).max(64).regex(namePattern, "Invalid header name"),
  required: z.boolean().optional(),
  description: z.string().max(500).optional(),
  example: z.string().max(1024).optional(),
  secret: z.boolean().optional(),
});

export const bodySchemaSchema = z.object({
  type: z.string().max(64).optional(),
  properties: z
    .record(
      z.object({
        type: z.string().max(64).optional(),
        description: z.string().max(500).optional(),
        example: z.unknown().optional(),
      }),
    )
    .optional(),
  required: z.array(z.string().max(64)).max(100).optional(),
  example: z.unknown().optional(),
});

export const authTypeSchema = z.enum(["none", "bearer", "api_key", "basic"]);

export const authInputSchema = z
  .object({
    token: z.string().max(4096).optional(),
    apiKey: z.string().max(4096).optional(),
    username: z.string().max(256).optional(),
    password: z.string().max(4096).optional(),
    headerName: z.string().max(64).regex(namePattern).optional(),
  })
  .strict();

const baseUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((value) => value.startsWith("http://") || value.startsWith("https://"), {
    message: "Base URL must use http or https",
  });

const pathSchema = z
  .string()
  .max(1000)
  .refine((value) => value.startsWith("/"), "Path must start with /")
  .refine((value) => !value.split("/").includes(".."), "Path traversal is not allowed")
  .refine((value) => !value.includes("://"), "Path must be relative");

export const createApiSchema = z.object({
  name: z.string().min(1).max(160),
  slug: z.string().regex(slugPattern).optional(),
  description: z.string().max(2000).optional().nullable(),
  categorySlug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).optional(),
  categoryName: z.string().min(1).max(80).optional(),
  providerSlug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).optional(),
  providerName: z.string().min(1).max(120).optional(),
  baseUrl: baseUrlSchema,
  path: pathSchema,
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  queryParams: z.array(paramDefSchema).max(50).default([]),
  pathParams: z.array(paramDefSchema).max(25).default([]),
  headersSchema: z.array(headerDefSchema).max(25).default([]),
  bodySchema: bodySchemaSchema.nullable().optional(),
  authType: authTypeSchema.default("none"),
  auth: authInputSchema.nullable().optional(),
  contentType: z.enum(["application/json", "application/x-www-form-urlencoded"]).default("application/json"),
  requestExample: z.record(z.unknown()).nullable().optional(),
  responseExample: z.unknown().nullable().optional(),
  docsUrl: z.string().url().max(2048).nullable().optional(),
  sourceUrl: z.string().url().max(2048).nullable().optional(),
  isPublic: z.boolean().default(false),
  isEnabled: z.boolean().default(true),
  isNsfw: z.boolean().default(false),
  allowExtraQuery: z.boolean().default(false),
  supportsStreaming: z.boolean().default(false),
  timeoutMs: z.number().int().min(1000).max(30000).default(15000),
  discoveryMetadata: z.record(z.unknown()).optional(),
});

export const updateApiSchema = createApiSchema
  .partial()
  .extend({
    clearAuth: z.boolean().optional(),
    isEnabled: z.boolean().optional(),
  })
  .strict();

export const importOpenApiSchema = z
  .object({
    url: z.string().url().max(2048).optional(),
    document: z.union([z.string().max(2_000_000), z.record(z.unknown())]).optional(),
    providerName: z.string().min(1).max(120).optional(),
    categorySlug: z.string().max(64).optional(),
    isPublic: z.boolean().default(false),
    dryRun: z.boolean().default(false),
    testAfterImport: z.boolean().default(false),
  })
  .refine((value) => Boolean(value.url) || Boolean(value.document), {
    message: "Provide either a document URL or the document content.",
  });

export const probeSchema = z.object({
  url: z.string().url().max(2048),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  headers: z.record(z.string().max(1024)).optional(),
  body: z.unknown().optional(),
  auth: z
    .object({
      type: z.enum(["none", "bearer", "api_key", "basic"]).default("none"),
      token: z.string().max(4096).optional(),
      apiKey: z.string().max(4096).optional(),
      headerName: z.string().max(64).optional(),
      username: z.string().max(256).optional(),
      password: z.string().max(4096).optional(),
    })
    .optional(),
  timeoutMs: z.number().int().min(1000).max(15000).default(10000),
});

export const createKeySchema = z.object({
  name: z.string().min(1).max(80),
  rateLimitPerMinute: z.number().int().min(1).max(1000).default(60),
  permissions: z.array(z.enum(["execute", "chat", "models"])).min(1).default(["execute", "chat", "models"]),
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
});

export const aiCapabilitiesSchema = z.object({
  chat: z.boolean().default(true),
  streaming: z.boolean().default(false),
  tools: z.boolean().default(false),
  usage: z.boolean().default(false),
});

export const createAiModelSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/),
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional().nullable(),
  adapter: z.enum(["openai_compatible", "anthropic_messages", "gemini_generate", "rebix_text"]),
  baseUrl: z.string().url().max(2048).optional().nullable(),
  chatPath: z.string().max(200).default("/chat/completions"),
  upstreamModel: z.string().max(200).optional().nullable(),
  apiSlug: z.string().max(80).optional().nullable(),
  authType: authTypeSchema.default("none"),
  auth: authInputSchema.nullable().optional(),
  capabilities: aiCapabilitiesSchema,
  contextWindow: z.number().int().min(0).max(10_000_000).optional().nullable(),
  isPublic: z.boolean().default(false),
  isEnabled: z.boolean().default(true),
});

export const updateAiModelSchema = createAiModelSchema
  .partial()
  .extend({ clearAuth: z.boolean().optional() });

export const chatCompletionSchema = z.object({
  model: z.string().min(1).max(120),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().max(100_000),
      }),
    )
    .min(1)
    .max(100),
  stream: z.boolean().optional().default(false),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().min(1).max(32_000).optional(),
  stop: z.union([z.string().max(200), z.array(z.string().max(200)).max(4)]).optional(),
  user: z.string().max(200).optional(),
  tools: z.any().optional(),
  tool_choice: z.any().optional(),
  response_format: z.any().optional(),
});

export const discoverSchema = z.object({
  sourceUrl: z.string().url().max(2048).default("https://api-rebix.zone.id/"),
  providerSlug: z.string().max(80).optional(),
  providerId: z.string().uuid().optional(),
  adapter: z.enum(["auto", "rebix_manifest", "json_manifest", "openapi"]).default("auto"),
  manifestPath: z.string().max(200).optional(),
  autoVerify: z.number().int().min(0).max(20).default(0),
});

export const discoveryVerifySchema = z.object({
  apiIds: z.array(z.string().uuid()).max(20).optional(),
  limit: z.number().int().min(1).max(20).default(10),
});
