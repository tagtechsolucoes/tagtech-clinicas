import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, resolveClinicSlug, withTenant, type DbHandle } from '../src/client';
import { appointments, patients, professionals, rooms, tenants, units } from '../src/schema';
import { createClinic, deleteClinics, type Clinic } from './fixtures';
import { APP_URL, OWNER_URL } from './urls';

// O teste mais importante do sistema: uma clínica nunca enxerga nem altera dados
// de outra (pacientes, principalmente), mesmo que o código da API peça.

let owner: DbHandle;
let app: DbHandle;
let a: Clinic;
let b: Clinic;

beforeAll(async () => {
  owner = createDb(OWNER_URL, { max: 2 });
  app = createDb(APP_URL, { max: 2 });
  a = await createClinic(owner.db, 'A');
  b = await createClinic(owner.db, 'B');
});

afterAll(async () => {
  await deleteClinics(owner.db, [a?.tenantId, b?.tenantId].filter(Boolean) as string[]);
  await app.close();
  await owner.close();
});

const at = (iso: string) => new Date(iso);

describe('usuário do banco da aplicação', () => {
  it('não é superusuário, não ignora RLS e não é dono das tabelas', async () => {
    const [role] = await app.db.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    const owned = await app.db.execute(
      sql`select tablename from pg_tables where schemaname = 'public' and tableowner = current_user`,
    );
    expect(owned).toHaveLength(0);
  });

  it('toda tabela com tenant_id tem RLS ligado', async () => {
    const unprotected = await owner.db.execute(sql`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
        and (c.relname = 'tenants' or exists (
          select 1 from pg_attribute a
          where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped))
    `);
    expect(unprotected.map((r) => r.relname)).toEqual([]);
  });

  it('não apaga pacientes nem consultas', async () => {
    await expect(
      withTenant(app.db, a.tenantId, (tx) =>
        tx.delete(patients).where(eq(patients.id, a.patientId)),
      ),
    ).rejects.toThrow();
  });
});

describe('sem clínica definida', () => {
  it('nenhuma tabela devolve linhas', async () => {
    for (const table of [tenants, units, professionals, patients, appointments]) {
      expect(await app.db.select().from(table)).toHaveLength(0);
    }
  });
});

describe('dentro da clínica A', () => {
  it('vê só os próprios pacientes', async () => {
    const rows = await withTenant(app.db, a.tenantId, (tx) => tx.select().from(patients));
    expect(rows.map((p) => p.name)).toEqual([a.patientName]);
  });

  it('não lê nem altera o paciente de B pelo id', async () => {
    await withTenant(app.db, a.tenantId, async (tx) => {
      expect(await tx.select().from(patients).where(eq(patients.id, b.patientId))).toHaveLength(0);
      const updated = await tx
        .update(patients)
        .set({ notes: 'invadido' })
        .where(eq(patients.id, b.patientId))
        .returning();
      expect(updated).toHaveLength(0);
    });
  });

  it('não marca consulta com profissional ou paciente de B', async () => {
    await expect(
      withTenant(app.db, a.tenantId, (tx) =>
        tx.insert(appointments).values({
          tenantId: a.tenantId,
          unitId: a.unitId,
          professionalId: b.professionalId,
          serviceId: a.serviceId,
          patientId: a.patientId,
          startsAt: at('2030-01-07T12:00:00Z'),
          endsAt: at('2030-01-07T12:30:00Z'),
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(app.db, a.tenantId, (tx) =>
        tx.insert(appointments).values({
          tenantId: a.tenantId,
          unitId: a.unitId,
          professionalId: a.professionalId,
          serviceId: a.serviceId,
          patientId: b.patientId,
          startsAt: at('2030-01-07T12:00:00Z'),
          endsAt: at('2030-01-07T12:30:00Z'),
        }),
      ),
    ).rejects.toThrow();
  });

  it('não cria nem apaga clínicas', async () => {
    await expect(
      withTenant(app.db, a.tenantId, (tx) =>
        tx.insert(tenants).values({ name: 'nova', slug: 'nova-x' }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(app.db, a.tenantId, (tx) => tx.delete(tenants).where(eq(tenants.id, a.tenantId))),
    ).rejects.toThrow();
  });
});

describe('agenda garantida pelo banco', () => {
  const book = (
    startsAt: string,
    endsAt: string,
    extra: { roomId?: string; professionalId?: string } = {},
  ) =>
    withTenant(app.db, a.tenantId, (tx) =>
      tx
        .insert(appointments)
        .values({
          tenantId: a.tenantId,
          unitId: a.unitId,
          professionalId: extra.professionalId ?? a.professionalId,
          serviceId: a.serviceId,
          patientId: a.patientId,
          startsAt: at(startsAt),
          endsAt: at(endsAt),
          ...(extra.roomId ? { roomId: extra.roomId } : {}),
        })
        .returning(),
    );

  it('o mesmo profissional não pega duas consultas ao mesmo tempo', async () => {
    const [first] = await book('2030-01-08T12:00:00Z', '2030-01-08T13:00:00Z');
    await expect(book('2030-01-08T12:30:00Z', '2030-01-08T13:30:00Z')).rejects.toThrow();
    // Encostar pode.
    await book('2030-01-08T13:00:00Z', '2030-01-08T13:30:00Z');
    // Depois de cancelada, o horário volta a ficar livre.
    await withTenant(app.db, a.tenantId, (tx) =>
      tx
        .update(appointments)
        .set({ status: 'cancelled', cancelReason: 'paciente desmarcou' })
        .where(eq(appointments.id, first!.id)),
    );
    await book('2030-01-08T12:00:00Z', '2030-01-08T12:30:00Z');
  });

  it('a mesma sala não recebe duas consultas ao mesmo tempo', async () => {
    const [room] = await withTenant(app.db, a.tenantId, (tx) =>
      tx
        .insert(rooms)
        .values({ tenantId: a.tenantId, unitId: a.unitId, name: 'Sala 1' })
        .returning(),
    );
    const [other] = await withTenant(app.db, a.tenantId, (tx) =>
      tx.insert(professionals).values({ tenantId: a.tenantId, name: 'Dr. Outro' }).returning(),
    );
    await book('2030-01-09T12:00:00Z', '2030-01-09T13:00:00Z', { roomId: room!.id });
    await expect(
      book('2030-01-09T12:30:00Z', '2030-01-09T13:00:00Z', {
        roomId: room!.id,
        professionalId: other!.id,
      }),
    ).rejects.toThrow();
  });

  it('cancelar exige motivo', async () => {
    const [x] = await book('2030-01-10T12:00:00Z', '2030-01-10T12:30:00Z');
    await expect(
      withTenant(app.db, a.tenantId, (tx) =>
        tx.update(appointments).set({ status: 'cancelled' }).where(eq(appointments.id, x!.id)),
      ),
    ).rejects.toThrow();
  });
});

describe('conexões do pool', () => {
  it('a clínica não vaza para a consulta seguinte', async () => {
    const single = createDb(APP_URL, { max: 1 });
    try {
      const inside = await withTenant(single.db, a.tenantId, (tx) => tx.select().from(patients));
      expect(inside).toHaveLength(1);
      expect(await single.db.select().from(patients)).toHaveLength(0);
    } finally {
      await single.close();
    }
  });

  it('recusa tenantId que não é UUID', async () => {
    await expect(withTenant(app.db, "x'; drop table patients; --", async () => 1)).rejects.toThrow(
      'tenantId inválido',
    );
  });
});

describe('endereço público', () => {
  it('resolve o slug da clínica', async () => {
    expect(await resolveClinicSlug(app.db, a.slug)).toBe(a.tenantId);
    expect(await resolveClinicSlug(app.db, a.slug.toUpperCase())).toBe(a.tenantId);
    expect(await resolveClinicSlug(app.db, 'nao-existe-123')).toBeNull();
  });
});
