import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { CompleteProfileUseCase } from '../application/use-cases/complete-profile';
import { GetMeUseCase } from '../application/use-cases/get-me';
import { SeedOrganizationRolesUseCase } from '../application/use-cases/seed-organization-roles';
import { identificationLookupValues, readStoredIdentification } from '../domain/value-objects';
import { IdentificationAlreadyExistsError } from '../domain/errors';
import { Credential } from '../domain/entities';
import { Email } from '../domain/value-objects';
import { User } from '../domain/rbac';
import { InMemoryUnitOfWork, MockAccessContextResolver, MockTokenService } from './helpers';

// `users.identification` guardaba "cedula:1710034065" (complete-profile) o el número solo (registro / Google):
// texto con prefijo a la vista, un pasaporte largo que no cabía en el VARCHAR(20) y duplicados que la unicidad no veía.
// Ahora: el número solo en `identification` y el tipo en `identification_type`.
const nodeRequire = createRequire(__filename);
const migration = nodeRequire('../../migrations/20261006000000-split-user-identification-type.js') as {
  splitPrefixed: (v: unknown) => { type: string; number: string } | null;
  planBackfill: (rows: { id: string; identification: string }[]) => {
    updates: { id: string; type: string; number: string }[];
    skipped: { id: string; reason: string }[];
  };
};

describe('readStoredIdentification (lee el formato nuevo y los dos viejos)', () => {
  it('formato nuevo: número solo + tipo aparte', () => {
    expect(readStoredIdentification('1790011674001', 'ruc')).toEqual({ type: 'ruc', number: '1790011674001' });
  });
  it('formato viejo de complete-profile: "tipo:número" en una sola columna', () => {
    expect(readStoredIdentification('cedula:1710034065', null)).toEqual({ type: 'cedula', number: '1710034065' });
    expect(readStoredIdentification('passport:AB123456', null)).toEqual({ type: 'passport', number: 'AB123456' });
  });
  it('registro sin tipo: se asume cédula, como siempre', () => {
    expect(readStoredIdentification('1710034065', null)).toEqual({ type: 'cedula', number: '1710034065' });
  });
  it('un valor con ":" que no es un tipo conocido no se parte', () => {
    expect(readStoredIdentification('abc:123', null)).toEqual({ type: 'cedula', number: 'abc:123' });
  });
  it('sin dato, nada', () => {
    expect(readStoredIdentification(null, null)).toBeNull();
    expect(readStoredIdentification('', null)).toBeNull();
  });
});

describe('identificationLookupValues (buscar duplicados sin importar el formato)', () => {
  it('incluye el número solo y las cuatro variantes con prefijo', () => {
    expect(identificationLookupValues('1710034065')).toEqual([
      '1710034065', 'cedula:1710034065', 'ruc:1710034065', 'passport:1710034065', 'dni:1710034065',
    ]);
  });
  it('si ya llega con prefijo, busca por el número', () => {
    expect(identificationLookupValues('cedula:1710034065')[0]).toBe('1710034065');
  });
});

describe('migración split-user-identification-type', () => {
  it('reparte las filas con prefijo', () => {
    const { updates, skipped } = migration.planBackfill([
      { id: 'a', identification: 'cedula:1710034065' },
      { id: 'b', identification: 'ruc:1790011674001' },
      { id: 'c', identification: '0912345678' }, // ya sin prefijo: no se toca
    ]);
    expect(updates).toEqual([
      { id: 'a', type: 'cedula', number: '1710034065' },
      { id: 'b', type: 'ruc', number: '1790011674001' },
    ]);
    expect(skipped).toEqual([]);
  });

  it('NO rompe la unicidad: si otra fila ya tiene ese número sin prefijo, la deja como está', () => {
    const { updates, skipped } = migration.planBackfill([
      { id: 'a', identification: 'cedula:1710034065' },
      { id: 'b', identification: '1710034065' },
    ]);
    expect(updates).toEqual([]);
    expect(skipped.map((s) => s.id)).toEqual(['a']);
  });

  it('NO rompe la unicidad: dos filas con prefijo que darían el mismo número se dejan', () => {
    const { updates, skipped } = migration.planBackfill([
      { id: 'a', identification: 'cedula:1710034065' },
      { id: 'b', identification: 'passport:1710034065' },
    ]);
    expect(updates).toEqual([]);
    expect(skipped.map((s) => s.id).sort()).toEqual(['a', 'b']);
  });

  it('un pasaporte largo que no cabía con prefijo queda bien repartido', () => {
    const { updates } = migration.planBackfill([{ id: 'a', identification: 'passport:ABCDEFGHIJ12345' }]);
    expect(updates).toEqual([{ id: 'a', type: 'passport', number: 'ABCDEFGHIJ12345' }]);
  });

  it('valores raros no se tocan', () => {
    expect(migration.splitPrefixed('x:1')).toBeNull();
    expect(migration.splitPrefixed('cedula:')).toBeNull();
    expect(migration.splitPrefixed(null)).toBeNull();
    expect(migration.planBackfill([{ id: 'a', identification: 'correo@x.com' }]).updates).toEqual([]);
  });
});

describe('complete-profile guarda número y tipo por separado', () => {
  let uow: InMemoryUnitOfWork;
  let completeProfile: CompleteProfileUseCase;
  let getMe: GetMeUseCase;

  async function addAccount(email: string): Promise<string> {
    const credential = Credential.createWithPassword({ email: Email.create(email), passwordHash: 'x' });
    await uow.credentials.save(credential);
    await uow.users.save(User.create({ id: credential.userId, email }));
    return credential.userId;
  }

  beforeEach(() => {
    uow = new InMemoryUnitOfWork();
    const seed = new SeedOrganizationRolesUseCase(uow);
    completeProfile = new CompleteProfileUseCase(uow, new MockTokenService(), new MockAccessContextResolver(), seed, uow.refreshTokens);
    getMe = new GetMeUseCase(uow.credentials, uow.users, uow.organizations);
  });

  it('cédula: en la base queda solo el número y el tipo aparte (ya no "cedula:…")', async () => {
    const userId = await addAccount('a@test.com');
    await completeProfile.execute({ userId, fullName: 'Ana', identificationType: 'cedula', identificationNumber: '1710034065' });

    const user = (await uow.users.findById(userId))!;
    expect(user.identification).toBe('1710034065');
    expect(user.identificationType).toBe('cedula');
    expect(user.identification).not.toContain(':');
  });

  it('un pasaporte largo cabe: antes "passport:" + 20 caracteres no entraba en el VARCHAR(20)', async () => {
    const userId = await addAccount('p@test.com');
    const number = 'A1B2C3D4E5F6G7H8I9J0';
    await completeProfile.execute({ userId, fullName: 'Pepe', identificationType: 'passport', identificationNumber: number });

    const user = (await uow.users.findById(userId))!;
    expect(user.identification).toBe(number);
    expect(user.identification!.length).toBeLessThanOrEqual(20);
    expect(user.identificationType).toBe('passport');
  });

  it('GET /auth/me devuelve el tipo correcto (RUC ya no sale como cédula)', async () => {
    const userId = await addAccount('r@test.com');
    await completeProfile.execute({ userId, fullName: 'Empresa', identificationType: 'ruc', identificationNumber: '1790011674001' });

    const me = await getMe.execute(userId, null, []);
    expect(me.identification).toEqual({ type: 'ruc', number: '1790011674001' });
  });

  it('GET /auth/me sigue entendiendo una fila vieja con "cedula:…"', async () => {
    const userId = await addAccount('v@test.com');
    const user = (await uow.users.findById(userId))!;
    user.completeProfile({ fullName: 'Vieja', identification: 'cedula:1710034065', identificationType: '' });
    // el formato viejo no traía tipo aparte
    await uow.users.save(User.fromPersistence({ ...user.toPersistence(), identificationType: null }));

    const me = await getMe.execute(userId, null, []);
    expect(me.identification).toEqual({ type: 'cedula', number: '1710034065' });
  });

  it('detecta el duplicado aunque el otro usuario lo tenga guardado con el formato viejo', async () => {
    const otro = await addAccount('otro@test.com');
    const o = (await uow.users.findById(otro))!;
    await uow.users.save(User.fromPersistence({ ...o.toPersistence(), identification: 'cedula:1710034065', identificationType: null }));

    const yo = await addAccount('yo@test.com');
    await expect(
      completeProfile.execute({ userId: yo, fullName: 'Yo', identificationType: 'cedula', identificationNumber: '1710034065' }),
    ).rejects.toThrow(IdentificationAlreadyExistsError);
  });

  it('detecta el duplicado contra un registro que guardó el número sin tipo', async () => {
    const otro = await addAccount('reg@test.com');
    const o = (await uow.users.findById(otro))!;
    await uow.users.save(User.fromPersistence({ ...o.toPersistence(), identification: '1710034065' }));

    const yo = await addAccount('yo2@test.com');
    await expect(
      completeProfile.execute({ userId: yo, fullName: 'Yo', identificationType: 'cedula', identificationNumber: '1710034065' }),
    ).rejects.toThrow(IdentificationAlreadyExistsError);
  });
});
