import { randomBytes } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import type { Db } from '../src/client';
import { patients, professionals, services, tenants, units } from '../src/schema';

export interface Clinic {
  tenantId: string;
  slug: string;
  unitId: string;
  professionalId: string;
  serviceId: string;
  patientId: string;
  patientName: string;
}

/** Cria uma clínica com unidade, profissional, serviço e paciente. Usa o dono do banco. */
export async function createClinic(ownerDb: Db, label: string): Promise<Clinic> {
  const slug = `c-${label.toLowerCase()}-${randomBytes(4).toString('hex')}`;
  const [tenant] = await ownerDb
    .insert(tenants)
    .values({ name: `Clínica ${label}`, slug })
    .returning();
  const tenantId = tenant!.id;
  const [unit] = await ownerDb
    .insert(units)
    .values({ tenantId, name: `Unidade ${label}` })
    .returning();
  const [pro] = await ownerDb
    .insert(professionals)
    .values({ tenantId, name: `Dra. ${label}` })
    .returning();
  const [service] = await ownerDb
    .insert(services)
    .values({ tenantId, name: `Consulta ${label}`, durationMinutes: 30 })
    .returning();
  const patientName = `Paciente secreto ${label}`;
  const [patient] = await ownerDb
    .insert(patients)
    .values({ tenantId, name: patientName })
    .returning();
  return {
    tenantId,
    slug,
    unitId: unit!.id,
    professionalId: pro!.id,
    serviceId: service!.id,
    patientId: patient!.id,
    patientName,
  };
}

export async function deleteClinics(ownerDb: Db, tenantIds: string[]): Promise<void> {
  if (tenantIds.length) await ownerDb.delete(tenants).where(inArray(tenants.id, tenantIds));
}
