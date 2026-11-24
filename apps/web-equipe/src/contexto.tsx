import { createContext, useContext } from 'react';
import type { Clinic, Me, Membership, Professional, Room, Service } from './api';

/** O que toda tela do painel precisa: quem está logado, a clínica e os cadastros básicos. */
export interface Painel {
  me: Me;
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

export function usePainel(): Painel {
  const ctx = useContext(PainelContexto);
  if (!ctx) throw new Error('usePainel fora do painel');
  return ctx;
}

/** Transforma um erro qualquer em texto para o recado. */
export const mensagem = (e: unknown) =>
  e instanceof Error ? e.message : 'Não foi possível concluir.';
