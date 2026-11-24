/** Papéis na clínica. O dono vem do cadastro; os outros entram por convite. */
export const CLINIC_ROLES = ['owner', 'manager', 'reception', 'professional'] as const;
export type ClinicRole = (typeof CLINIC_ROLES)[number];
export type InvitableRole = Exclude<ClinicRole, 'owner'>;

export const ROLE_LABELS: Record<ClinicRole, string> = {
  owner: 'Dono',
  manager: 'Gerente',
  reception: 'Recepção',
  professional: 'Profissional',
};

/**
 * Quem pode dar (ou tirar) qual papel. O dono cuida de todos menos de outros donos;
 * o gerente cuida de recepção e profissionais. Ninguém mexe no próprio papel.
 */
export function rolesManagedBy(actor: string): InvitableRole[] {
  if (actor === 'owner') return ['manager', 'reception', 'professional'];
  if (actor === 'manager') return ['reception', 'professional'];
  return [];
}

export function canManage(actor: string, target: string): boolean {
  return (rolesManagedBy(actor) as string[]).includes(target);
}
