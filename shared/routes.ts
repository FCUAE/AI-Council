import { z } from 'zod';
import { insertQuerySchema, queries, responses, insertConversationSchema, conversations, messages, councilResponses } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  // New conversation-based API
  conversations: {
    list: {
      method: 'GET' as const,
      path: '/api/conversations',
      responses: {
        200: z.array(z.custom<typeof conversations.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/conversations/:id',
      responses: {
        200: z.custom<typeof conversations.$inferSelect & { 
          messages: (typeof messages.$inferSelect & { 
            councilResponses: typeof councilResponses.$inferSelect[] 
          })[] 
        }>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/conversations',
      input: z.object({ 
        prompt: z.string().min(1),
        attachments: z.array(z.object({
          name: z.string(),
          url: z.string(),
          type: z.string(),
          size: z.number()
        })).max(30).optional(),
        models: z.array(z.string()).length(3).optional(),
        chairmanModel: z.string().optional()
      }),
      responses: {
        201: z.custom<typeof conversations.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    rename: {
      method: 'PATCH' as const,
      path: '/api/conversations/:id',
      input: z.object({
        title: z.string().min(1).max(200),
      }),
      responses: {
        200: z.object({ message: z.string() }),
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/conversations/:id',
      responses: {
        200: z.object({ message: z.string() }),
        404: errorSchemas.notFound,
      },
    },
    addMessage: {
      method: 'POST' as const,
      path: '/api/conversations/:id/messages',
      input: z.object({ 
        prompt: z.string().min(1),
        attachments: z.array(z.object({
          name: z.string(),
          url: z.string(),
          type: z.string(),
          size: z.number()
        })).max(30).optional(),
        expectedCost: z.number().int().positive().optional(),
        models: z.array(z.string()).length(3).optional(),
        chairmanModel: z.string().optional()
      }),
      responses: {
        201: z.custom<typeof messages.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
  },
  // Legacy API
  queries: {
    list: {
      method: 'GET' as const,
      path: '/api/queries',
      responses: {
        200: z.array(z.custom<typeof queries.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/queries/:id',
      responses: {
        200: z.custom<typeof queries.$inferSelect & { responses: typeof responses.$inferSelect[] }>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/queries',
      input: insertQuerySchema,
      responses: {
        201: z.custom<typeof queries.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

export type { InsertQuery } from './schema';
