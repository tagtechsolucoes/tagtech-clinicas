import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentTenant, Roles, TenantGuard, type TenantContext } from '../auth/auth.guard';
import { validate } from '../common/validate';
import { RelationshipService } from './relationship.service';

const token = z.string().regex(/^[A-Za-z0-9_-]{22}$/, 'Link inválido');
const settingsSchema = z
  .object({
    waitlistAutoOffer: z.boolean(),
    reactivationDays: z.union([z.literal(0), z.number().int().min(60).max(730)]),
    googleReviewUrl: z.union([
      z.literal(''),
      z
        .string()
        .trim()
        .url('Link inválido')
        .max(300)
        .refine((u) => u.startsWith('https://'), 'Use um link https'),
    ]),
  })
  .partial()
  .strict();
const answerSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(1000).default(''),
  })
  .strict();

@Controller('relationship')
@UseGuards(TenantGuard)
@Roles('owner', 'manager')
export class RelationshipController {
  constructor(@Inject(RelationshipService) private readonly service: RelationshipService) {}

  @Get('settings')
  settings(@CurrentTenant() ctx: TenantContext) {
    return this.service.settings(ctx);
  }

  @Patch('settings')
  save(@CurrentTenant() ctx: TenantContext, @Body() body: unknown) {
    return this.service.saveSettings(ctx, validate(settingsSchema, body));
  }

  @Get('reviews')
  reviews(@CurrentTenant() ctx: TenantContext) {
    return this.service.reviews(ctx);
  }
}

/** Links que o paciente recebe: vaga da lista de espera e avaliação. Sem login. */
@Controller('public')
export class PublicRelationshipController {
  constructor(@Inject(RelationshipService) private readonly service: RelationshipService) {}

  @Get('offers/:token')
  offer(@Param('token') value: string) {
    return this.service.offer(validate(token, value));
  }

  @Post('offers/:token/accept')
  @HttpCode(200)
  accept(@Param('token') value: string) {
    return this.service.acceptOffer(validate(token, value));
  }

  @Post('offers/:token/decline')
  @HttpCode(200)
  decline(@Param('token') value: string) {
    return this.service.declineOffer(validate(token, value));
  }

  @Get('reviews/:token')
  review(@Param('token') value: string) {
    return this.service.review(validate(token, value));
  }

  @Post('reviews/:token')
  @HttpCode(200)
  answer(@Param('token') value: string, @Body() body: unknown) {
    const { rating, comment } = validate(answerSchema, body);
    return this.service.answerReview(validate(token, value), rating, comment);
  }
}
