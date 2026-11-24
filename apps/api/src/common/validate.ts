import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/** Valida a entrada com um schema Zod. Entrada inválida vira 400 com os campos errados. */
export function validate<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException({
      message: 'Dados inválidos',
      fields: result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}
