import { z } from 'zod';
import { ApiErrorResponseSchema } from './errors';

export const ApiSuccessResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  });

export type ApiSuccessResponse<T> = {
  success: true;
  data: T;
};

export function createApiSuccessResponse<T>(data: T): ApiSuccessResponse<T> {
  return { success: true, data };
}

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    hasNextPage: z.boolean(),
    hasPreviousPage: z.boolean(),
  });

export type PaginatedResponse<T> = {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export function createPaginatedResponse<T>(input: {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
}): PaginatedResponse<T> {
  const totalPages = input.pageSize === 0 ? 0 : Math.ceil(input.totalItems / input.pageSize);

  return PaginatedResponseSchema(z.unknown()).parse({
    items: input.items,
    page: input.page,
    pageSize: input.pageSize,
    totalItems: input.totalItems,
    totalPages,
    hasNextPage: input.page < totalPages,
    hasPreviousPage: input.page > 1,
  }) as PaginatedResponse<T>;
}

export { ApiErrorResponseSchema };
export type { ApiErrorResponse } from './errors';
