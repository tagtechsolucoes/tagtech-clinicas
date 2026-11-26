import { createContext, useContext } from 'react';
import type {
  Clinic,
  Feature,
  Me,
  Membership,
  Professional,
  Room,
  Service,
  Subscription,
} from './api';

/** O que toda tela do painel precisa: quem está logado, a clínica e os cadastros básicos. */
export interface Painel {
  me: Me;
  /** Plano e situação da assinatura com a TagTech. */
  assinatura: Subscription;
  /** Recurso liberado no plano (e assinatura não bloqueada). */
  tem: (f: Feature) => boolean;
  /** Pessoa da equipe TagTech (vê todas as clínicas). */
  admin: boolean;
  vinculo: Membership;
  clinic: Clinic;
  professionals: Professional[];
  services: Service[];
  rooms: Room[];
  /** Recarrega clínica, profissionais, serviços e salas. */
  recarregar: () => Promise<void>;
  setClinic: (c: Clinic) => void;
  avisar: (texto: string, tipo?: 'ok' | 'erro') => void;
  /** Dono e gerente mexem no cadastro. */
  gerencia: boolean;
}

export const PainelContexto = createContext<Painel | null>(null);

/** Recado fora do painel (administração da TagTech, que não abre nenhuma clínica). */
export const AvisoContexto = createContext<Painel['avisar'] | null>(null);

/** O recado do painel, ou o da administração quando não há clínica aberta. */
export function useAvisar(): Painel['avisar'] {
  const painel = useContext(PainelContexto);
  const avulso = useContext(AvisoContexto);
  const avisar = painel?.avisar ?? avulso;
  if (!avisar) throw new Error('useAvisar fora do painel');
  return avisar;
}

export function usePainel(): Painel {
  const ctx = useContext(PainelContexto);
  if (!ctx) throw new Error('usePainel fora do painel');
  return ctx;
}

/** Transforma um erro qualquer em texto para o recado. */
export const mensagem = (e: unknown) =>
  e instanceof Error ? e.message : 'Não foi possível concluir.';
