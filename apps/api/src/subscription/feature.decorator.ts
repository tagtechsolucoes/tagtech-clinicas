import { SetMetadata } from '@nestjs/common';
import type { Feature } from '@tagtech/domain';

export const FEATURE_KEY = 'tagtech:feature';
export const ALWAYS_KEY = 'tagtech:always';

/** A rota exige um recurso do plano. */
export const RequiresFeature = (f: Feature) => SetMetadata(FEATURE_KEY, f);
/** A rota funciona mesmo com a assinatura bloqueada (ver o plano, sair, exportar dados). */
export const EvenWhenBlocked = () => SetMetadata(ALWAYS_KEY, true);
