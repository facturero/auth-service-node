# RBAC — Guía de implementación (para agente de codificación)

> **Objetivo.** Añadir la capa de **autorización (RBAC)** a `auth-service`, que hoy solo hace **autenticación**. Al terminar, auth-service será el **único servicio de identidad y acceso**: dueño de usuarios, roles y permisos, y emisor de un JWT que **lleva los permisos** del usuario (`org_id`, `country_code`, `permissions[]`, `pv`).
>
> **Para el agente (opencode / big pickle):** este documento es la fuente de verdad de la tarea. Sigue las fases **en orden**. No inventes patrones nuevos: **imita los archivos existentes** del repo (mismos estilos de entidad, error, repositorio, controlador y wiring). Marca cada checkbox al completarlo. No rompas los flujos de autenticación actuales ni los tests existentes.
>
> **⚠️ Estado (actualizado): RBAC IMPLEMENTADO · Onboarding = Opción A.** El RBAC ya está en el código. El **onboarding cambió a Opción A**: `auth` crea la **organización mínima** (`id`) y **siembra el rol Administrador al fundador dentro de `register`/`google`** — NO vía un consumer de `organization.org.created`, y NO hay saga de creación entre servicios. `organization-service` completa el **perfil fiscal** con `PUT /organizations/me`, y `auth` **consume `organization.org.updated`** para refrescar el `country_code` de su read-model. Donde el texto (p. ej. §7.2 y §9.2) mencione un consumer de `org.created` o una saga de onboarding, **prevalece §0.1**.

---

## 0. Contexto y reglas de oro

**Stack real** (no cambiar): Node ≥20, TypeScript `strict`, `type: commonjs`, Hono, Sequelize + `mysql2` (base `auth_db`), `jose` (RS256), `argon2`, Zod, `vitest`, migraciones con `sequelize-cli`. Diseño: **Clean Architecture** (`domain ← application ← infrastructure/interface`).

**Reglas de oro (obligatorias):**

1. **Imita los patrones existentes**, archivo por archivo:
   - Entidades: clase con constructor privado + factories estáticas + `fromPersistence()` + `toPersistence()` (ver `src/domain/entities.ts`).
   - Errores: extienden `AppError` con `code`, `httpStatus`, `details` (ver `src/domain/errors.ts`). Los casos de uso **lanzan** errores de dominio; no usan `Result` para el flujo normal.
   - Repositorios: interfaz en `domain/repositories.ts`; implementación Sequelize en `infrastructure/persistence/repositories.ts` como factory `(tx?: Transaction) => Repo`. `save` = **upsert**. Añadir cada repo al agregado `Repositories` y a `buildRepositories()`.
   - Modelos Sequelize: `timestamps: false`, `underscored: true`, `CHAR(36)` para ids, columnas en `snake_case` (ver `src/infrastructure/persistence/models.ts`).
   - HTTP: controladores como **factories** que reciben el caso de uso y devuelven un handler Hono; validación con `validateJson(schema)`; el `errorHandler` central traduce `AppError`.
   - Wiring: **solo** en `src/main.ts` (composition root) se instancian implementaciones concretas.
2. **Compatibilidad hacia atrás del JWT:** los claims nuevos se **añaden**; `sub` y `email` se mantienen. `GET /auth/me` y los tests actuales deben seguir pasando.
3. **Una sola base (`auth_db`).** Las tablas RBAC viven aquí; `credential.user_id` pasa a ser **FK real** hacia `users.id`. Referencias a otros servicios (ej. `organization_id`) son por **ID**, nunca FK ni JOIN cruzado.
4. **Aislamiento por `organization_id`** en toda operación RBAC (un rol/permiso siempre se evalúa en el contexto de una organización).
5. **No** metas PII sensible ni secretos en el JWT. `permissions` es una lista acotada de códigos `recurso:acción`.
6. Tras cada fase: `npm run typecheck` y `npm test` deben pasar. Commits pequeños por fase.

**Diseño de referencia (vault de arquitectura):** `arquitectura/autorizacion.md`, `servicios/auth-service.md`. Resumen del reparto de responsabilidades: auth **firma** el token con permisos → el **gateway** hace enforcement grueso (`ruta→permiso`) → cada **servicio** hace enforcement fino (por recurso) leyendo `X-Permissions`. Revocación en dos capas: **TTL corto (15 min)** + **`permissions_version` (`pv`)**.

---

## 0.1 Ciclo de vida y onboarding (Opción A)

Regla base: **crear un usuario ≠ completar el perfil fiscal ≠ asignar un rol.** Disparadores distintos:

| Qué se crea | Disparador | Dónde |
|---|---|---|
| Catálogo de `permissions` + roles plantilla | migración/seed (deploy) | auth |
| `User` + **organización mínima** (`id`) + roles de la org (clon) + `Membership` + rol **Administrador** del fundador | **`register` / `google`** (fundador) | **auth** (todo en una transacción) |
| Perfil fiscal (razón social, RUC, país) + establecimiento 001 + punto 001 | **`PUT /organizations/me`** | **organization-service** |
| `Membership` + `UserRole` de un empleado | invitación/asignación de un admin | auth |

**Opción A (la construida):** el fundador, al **registrarse**, ya obtiene `org_id` + rol Administrador — todo dentro de auth, atómico. **No hay saga de creación entre servicios ni compensación**: la organización nace completa (identidad + acceso) en auth. Lo que falta después son los **datos fiscales**, que completa organization-service con `PUT /organizations/me` (paso independiente y reintentable).

### Qué es de auth y qué es de organization-service

- **auth** es dueño de la **identidad** y de un **read-model mínimo** de la organización: solo `id` + `country_code` (lo que necesita para el JWT). Crea esa fila mínima en `register` y siembra el rol admin.
- **organization-service** es dueño del **perfil de negocio**: razón social, nombre comercial, RUC, país, establecimientos, puntos de emisión. Mismo `organization_id`.
- El `country_code` del read-model de auth arranca en `null` y se actualiza cuando auth **consume `organization.org.updated`** (que emite organization-service al completar el perfil). Ver §9.2.

### Estados de onboarding (para el front)

- Tras `register`: el JWT ya trae `org_id` + `permissions` de admin, pero `country_code = null` → **perfil fiscal pendiente** → el front lleva a `PUT /organizations/me`.
- `identification_number = null` en el `User` → **completar perfil personal** (§7.5).
- **Invitado** (`InviteUser`): nace ya atado a la organización existente (membership + rol); no crea organización.

### Nota sobre "usuario sin organización"

Con Opción A, un usuario **normal** (fundador o invitado) **siempre** tiene organización desde el primer momento (auth se la da en `register`, o la invitación lo ata a una existente). El único caso sin organización es el `is_platform_admin` (soporte), creado por seed. No se pone constraint `NOT NULL` de membership a nivel de tabla (rompería al platform admin).

---

## 1. Migración de base de datos (RBAC + users)

Crea `migrations/20260702120000-create-rbac-tables.js` (usa la marca de tiempo actual). Debe:

1. Crear tablas: `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `organization_memberships`, y el **read-model** `organizations` (solo lo que auth necesita: id + country_code + name).
2. Crear la fila `users` para **cada credencial existente** (backfill: `id = credentials.user_id`, `email = credentials.email`).
3. Añadir la FK `credentials.user_id → users.id` (después del backfill).

```js
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { CHAR, STRING, BOOLEAN, INTEGER, ENUM, DATE } = Sequelize;

    // 1. users (la persona) -----------------------------------------------
    await queryInterface.createTable('users', {
      id: { type: CHAR(36), primaryKey: true },
      email: { type: STRING(255), allowNull: false, unique: true },
      full_name: { type: STRING(255), allowNull: true },
      identification_type: { type: STRING(20), allowNull: true },   // cedula|ruc|passport|dni
      identification_number: { type: STRING(30), allowNull: true },
      status: { type: ENUM('active', 'disabled'), allowNull: false, defaultValue: 'active' },
      is_platform_admin: { type: BOOLEAN, allowNull: false, defaultValue: false },
      permissions_version: { type: INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: DATE, allowNull: false },
      updated_at: { type: DATE, allowNull: false },
    });
    // Única global sobre (type, number). En MySQL los NULL no colisionan, así que
    // varios usuarios sin identificación conviven; la unicidad aplica al estar ambos set.
    await queryInterface.addIndex('users', ['identification_type', 'identification_number'], {
      unique: true, name: 'uq_users_identification',
    });

    // 2. organizations (read-model mínimo; se llena por evento org.created)
    await queryInterface.createTable('organizations', {
      id: { type: CHAR(36), primaryKey: true }, // = organization_id de organization-service
      name: { type: STRING(255), allowNull: true },
      country_code: { type: STRING(2), allowNull: true },
      created_at: { type: DATE, allowNull: false },
      updated_at: { type: DATE, allowNull: false },
    });

    // 3. permissions (catálogo de plataforma) -----------------------------
    await queryInterface.createTable('permissions', {
      id: { type: CHAR(36), primaryKey: true },
      code: { type: STRING(100), allowNull: false, unique: true }, // 'customer:create'
      resource: { type: STRING(50), allowNull: false },
      action: { type: STRING(50), allowNull: false },
      description: { type: STRING(255), allowNull: true },
    });

    // 4. roles (por organización; organization_id NULL = plantilla global)
    await queryInterface.createTable('roles', {
      id: { type: CHAR(36), primaryKey: true },
      organization_id: { type: CHAR(36), allowNull: true },
      name: { type: STRING(100), allowNull: false },
      description: { type: STRING(255), allowNull: true },
      is_system: { type: BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: DATE, allowNull: false },
      updated_at: { type: DATE, allowNull: false },
    });
    await queryInterface.addIndex('roles', ['organization_id', 'name'], { unique: true });

    // 5. role_permissions (N:M) ------------------------------------------
    await queryInterface.createTable('role_permissions', {
      role_id: { type: CHAR(36), allowNull: false, references: { model: 'roles', key: 'id' }, onDelete: 'CASCADE' },
      permission_id: { type: CHAR(36), allowNull: false, references: { model: 'permissions', key: 'id' }, onDelete: 'CASCADE' },
    });
    await queryInterface.addConstraint('role_permissions', {
      fields: ['role_id', 'permission_id'], type: 'primary key', name: 'pk_role_permissions',
    });

    // 6. user_roles (asignación por organización) -------------------------
    await queryInterface.createTable('user_roles', {
      id: { type: CHAR(36), primaryKey: true },
      user_id: { type: CHAR(36), allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      organization_id: { type: CHAR(36), allowNull: false },
      role_id: { type: CHAR(36), allowNull: false, references: { model: 'roles', key: 'id' }, onDelete: 'CASCADE' },
      created_at: { type: DATE, allowNull: false },
    });
    await queryInterface.addIndex('user_roles', ['user_id', 'organization_id', 'role_id'], { unique: true });

    // 7. organization_memberships ----------------------------------------
    await queryInterface.createTable('organization_memberships', {
      id: { type: CHAR(36), primaryKey: true },
      user_id: { type: CHAR(36), allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      organization_id: { type: CHAR(36), allowNull: false },
      status: { type: ENUM('active', 'invited', 'disabled'), allowNull: false, defaultValue: 'active' },
      created_at: { type: DATE, allowNull: false },
      updated_at: { type: DATE, allowNull: false },
    });
    await queryInterface.addIndex('organization_memberships', ['user_id', 'organization_id'], { unique: true });

    // 8. backfill users desde credentials + FK ----------------------------
    await queryInterface.sequelize.query(`
      INSERT INTO users (id, email, status, is_platform_admin, permissions_version, created_at, updated_at)
      SELECT user_id, email, 'active', false, 0, NOW(), NOW() FROM credentials
    `);
    await queryInterface.addConstraint('credentials', {
      fields: ['user_id'], type: 'foreign key', name: 'fk_credentials_user',
      references: { table: 'users', field: 'id' }, onDelete: 'RESTRICT',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeConstraint('credentials', 'fk_credentials_user');
    for (const t of ['organization_memberships', 'user_roles', 'role_permissions', 'roles', 'permissions', 'organizations', 'users']) {
      await queryInterface.dropTable(t);
    }
  },
};
```

- [ ] Migración creada y `npm run db:migrate` corre limpio contra una base de prueba. `db:migrate:undo` revierte sin error.

> **Nota MySQL:** los `ENUM` requeridos por `down` a veces dejan tipos; si `dropTable` falla por orden de FKs, respeta el orden inverso (hijos antes que padres) como en el snippet.

---

## 2. Seed del catálogo de permisos y roles plantilla

Crea `migrations/20260702130000-seed-rbac-catalog.js` (seed idempotente vía `bulkInsert` con ids deterministas, o `INSERT ... ON DUPLICATE KEY UPDATE`). Inserta:

**Catálogo de permisos** (`permissions`) — genera un id por fila (uuid fijo o derivado del code):

```
customer:create customer:read customer:update customer:delete
product:create  product:read  product:update  product:delete
invoice:create  invoice:read  invoice:void    invoice:authorize
organization:read organization:update
establishment:create establishment:read establishment:update
user:invite user:read user:update user:assign_role
tax_config:read report:read analytics:read
```
(`resource`/`action` se derivan partiendo el code por `:`.)

**Roles plantilla** (`roles` con `organization_id = NULL`, `is_system = true`): `Administrador`, `Vendedor`, `Contador`, `Solo lectura`, con estos `role_permissions`:

| Rol plantilla | Permisos |
|---|---|
| Administrador | **todos** los del catálogo |
| Vendedor | `customer:*`, `product:read`, `invoice:create`, `invoice:read` |
| Contador | `invoice:read`, `report:read`, `tax_config:read` |
| Solo lectura | todos los `*:read` |

- [ ] Seed creado, idempotente (correrlo dos veces no duplica), y verificable con `SELECT count(*) FROM permissions;`.

---

## 3. Dominio (`src/domain/`)

Sigue **exactamente** el estilo de `entities.ts`/`value-objects.ts`/`errors.ts`.

### 3.1 Entidades — nuevo archivo `src/domain/rbac.ts`

Implementa como clases con constructor privado + factories + `fromPersistence` + `toPersistence` + getters:

- `User` — props: `id, email, fullName|null, identificationType|null, identificationNumber|null, status: 'active'|'disabled', isPlatformAdmin, permissionsVersion, createdAt, updatedAt`.
  - `static create({ id?, email, fullName? })` (si `id` no se pasa, generar; **importante:** al registrar, el `user.id` debe ser el mismo `credential.userId`, así que `create` acepta `id` explícito).
  - `completeProfile({ fullName, identification })`: fija nombre + identificación (VO `Identification`); requerido para activar al usuario (ver §0.1 y §7.5).
  - Métodos: `disable()`, `bumpPermissionsVersion()` (incrementa `permissionsVersion` y `updatedAt`), `isActive()`.
- `Role` — `id, organizationId|null, name, description|null, isSystem, createdAt, updatedAt`. `static createForOrg({ organizationId, name, description?, isSystem? })`, `static template(...)`.
- `Permission` — `id, code, resource, action, description|null`. (Solo lectura en runtime; el catálogo se siembra por migración.)
- `Membership` — `id, userId, organizationId, status: 'active'|'invited'|'disabled', createdAt, updatedAt`. `static create({ userId, organizationId, status? })`.
- `UserRole` — `id, userId, organizationId, roleId, createdAt`. `static assign({ userId, organizationId, roleId })`.

> **Value object `Identification`** (en `src/domain/value-objects.ts`, junto a `Email`): encapsula `{ type: 'cedula'|'ruc'|'passport'|'dni', number: string }` con validación por tipo (cédula EC = 10 dígitos + verificador; RUC = 13; pasaporte formato libre). Lanza `InvalidIdentificationError`. El país de la persona **no** se deriva de la organización (puede diferir). No confundir con la identificación del **cliente** del CRM (vive en customer-service).

### 3.2 Errores — añadir a `src/domain/errors.ts`

```ts
export class ForbiddenError extends AppError {
  readonly code = 'FORBIDDEN';
  readonly httpStatus = 403;
  constructor(message = 'Permiso insuficiente.') { super(message); }
}
export class UserNotFoundError extends AppError {
  readonly code = 'USER_NOT_FOUND'; readonly httpStatus = 404;
  constructor(message = 'Usuario no encontrado.') { super(message); }
}
export class RoleNotFoundError extends AppError {
  readonly code = 'ROLE_NOT_FOUND'; readonly httpStatus = 404;
  constructor(message = 'Rol no encontrado.') { super(message); }
}
export class NotOrganizationMemberError extends AppError {
  readonly code = 'NOT_ORG_MEMBER'; readonly httpStatus = 403;
  constructor(message = 'El usuario no pertenece a esa organización.') { super(message); }
}
export class InvalidIdentificationError extends AppError {
  readonly code = 'INVALID_IDENTIFICATION'; readonly httpStatus = 422;
  constructor(message = 'La identificación no es válida.') { super(message); }
}
```

### 3.3 Repositorios (interfaces) — añadir a `src/domain/repositories.ts`

```ts
export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  save(user: User): Promise<void>;
  incrementPermissionsVersion(userId: string): Promise<void>; // pv++
  listByOrganization(organizationId: string): Promise<User[]>;
}
export interface RoleRepository {
  findById(id: string): Promise<Role | null>;
  findTemplates(): Promise<Role[]>;                 // organization_id NULL
  findByOrganization(organizationId: string): Promise<Role[]>;
  save(role: Role): Promise<void>;
  setPermissions(roleId: string, permissionIds: string[]): Promise<void>;
}
export interface PermissionRepository {
  findAll(): Promise<Permission[]>;
  findIdsByCodes(codes: string[]): Promise<string[]>;
}
export interface MembershipRepository {
  find(userId: string, organizationId: string): Promise<Membership | null>;
  listActiveByUser(userId: string): Promise<Membership[]>;
  save(m: Membership): Promise<void>;
}
export interface UserRoleRepository {
  assign(userRole: UserRole): Promise<void>;
  remove(userId: string, organizationId: string, roleId: string): Promise<void>;
  listByUserAndOrg(userId: string, organizationId: string): Promise<UserRole[]>;
  listUserIdsByRole(roleId: string): Promise<string[]>; // para pv-bump masivo
}

/** Consulta de solo lectura para armar los permisos efectivos del JWT. */
export interface AccessQuery {
  effectivePermissions(userId: string, organizationId: string): Promise<string[]>;
  countryCodeOf(organizationId: string): Promise<string | null>;
}
```

Amplía el agregado `Repositories` con: `users, roles, permissions, memberships, userRoles`. (El `AccessQuery` **no** va en `Repositories`; es un puerto de lectura aparte, ver §5.)

- [ ] `src/domain/rbac.ts` creado; errores y repos añadidos; `npm run typecheck` pasa (aún sin implementaciones concretas — usa `// TODO` mínimos si hace falta compilar, pero preferible implementar §4 seguido).

---

## 4. Persistencia (`src/infrastructure/persistence/`)

### 4.1 Modelos — añadir a `models.ts`

Un modelo por tabla nueva (`UserModel`, `RoleModel`, `PermissionModel`, `RolePermissionModel`, `UserRoleModel`, `MembershipModel`, `OrganizationModel`), todos con `timestamps: false`, `underscored: true`, `CHAR(36)`. Replica el estilo de los modelos existentes (declaraciones `declare`, `Model.init`, `indexes`). Añade la asociación `CredentialModel.belongsTo(UserModel, { foreignKey: 'user_id' })`.

### 4.2 Repositorios Sequelize — añadir a `repositories.ts`

- Mappers `toUser`, `toRole`, `toPermission`, `toMembership`, `toUserRole` (modelo→dominio), como los existentes.
- Factories `userRepository(tx?)`, etc., y añádelas a `buildRepositories(tx?)`.
- Detalles clave:
  - `incrementPermissionsVersion(userId)` → `UPDATE users SET permissions_version = permissions_version + 1, updated_at = NOW() WHERE id = ?` (usa `UserModel.increment` o `sequelize.query` con la `tx`).
  - `setPermissions(roleId, permissionIds)` → borra las filas de `role_permissions` del rol y reinserta (dentro de la `tx`).
  - `RolePermissionModel` no tiene `id` propio (PK compuesta): al `init`, marca ambas columnas `primaryKey: true`.

### 4.3 `AccessQuery` (lectura para el JWT) — nuevo `src/infrastructure/persistence/access-query.ts`

```ts
import { QueryTypes } from 'sequelize';
import { sequelize } from './sequelize';
import { AccessQuery } from '../../domain/repositories';

export const sequelizeAccessQuery: AccessQuery = {
  async effectivePermissions(userId, organizationId) {
    const rows = await sequelize.query<{ code: string }>(
      `SELECT DISTINCT p.code
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p       ON p.id = rp.permission_id
        WHERE ur.user_id = :userId AND ur.organization_id = :organizationId`,
      { replacements: { userId, organizationId }, type: QueryTypes.SELECT },
    );
    return rows.map((r) => r.code);
  },
  async countryCodeOf(organizationId) {
    const rows = await sequelize.query<{ country_code: string | null }>(
      `SELECT country_code FROM organizations WHERE id = :organizationId LIMIT 1`,
      { replacements: { organizationId }, type: QueryTypes.SELECT },
    );
    return rows[0]?.country_code ?? null;
  },
};
```

- [ ] Modelos, repos y `AccessQuery` implementados; `buildRepositories` ampliado; `npm run typecheck` pasa.

---

## 5. Enriquecer el JWT (claims + resolución de contexto)

### 5.1 `AccessTokenClaims` — ampliar en `src/application/ports.ts`

```ts
export interface AccessTokenClaims {
  sub: string;            // user_id
  email: string;
  orgId: string | null;         // organización activa (null si no tiene membership)
  countryCode: string | null;   // país de la org activa
  permissions: string[];        // ['customer:read', ...]
  pv: number;                   // permissions_version
}
```

### 5.2 `jwt-token-service.ts` — firmar y verificar los nuevos claims

- `issueAccessToken`: añadir al payload `org_id`, `country_code`, `permissions`, `pv` (además de `email`, `token_use: 'access'`). Ejemplo del `SignJWT`:
  ```ts
  new SignJWT({
    email: claims.email,
    org_id: claims.orgId ?? null,
    country_code: claims.countryCode ?? null,
    permissions: claims.permissions ?? [],
    pv: claims.pv ?? 0,
    token_use: 'access',
  })
  ```
- `verifyAccessToken`: leer esos claims del `payload` con defaults seguros y devolver el `AccessTokenClaims` completo:
  ```ts
  return {
    sub: payload.sub, email: payload.email as string,
    orgId: (payload.org_id as string | null) ?? null,
    countryCode: (payload.country_code as string | null) ?? null,
    permissions: Array.isArray(payload.permissions) ? payload.permissions as string[] : [],
    pv: typeof payload.pv === 'number' ? payload.pv : 0,
  };
  ```
  (Mantén la validación existente de `sub`/`email`.)

### 5.3 Nuevo puerto `AccessContextResolver` (`src/application/ports.ts`)

```ts
export interface AccessContext {
  orgId: string | null;
  countryCode: string | null;
  permissions: string[];
  pv: number;
}
export interface AccessContextResolver {
  /** Resuelve el contexto de acceso del usuario para su organización activa
   *  (o la preferida, si es miembro de ella). */
  resolve(userId: string, preferredOrgId?: string | null): Promise<AccessContext>;
}
```

Implementación en `src/infrastructure/security/access-context-resolver.ts`:
- Lee `pv` del usuario (`UserRepository.findById`).
- Elige `orgId`: si `preferredOrgId` y el usuario tiene membership **activa** ahí → esa; si no, la primera membership activa (`MembershipRepository.listActiveByUser`), o `null`.
- Si hay `orgId`: `permissions = AccessQuery.effectivePermissions(userId, orgId)`, `countryCode = AccessQuery.countryCodeOf(orgId)`. Si no: `permissions = []`, `countryCode = null`.

### 5.4 `session.ts` — usar el resolver

`issueSession(...)` recibe además `accessContext: AccessContextResolver` y `preferredOrgId?`. Antes de `issueAccessToken`, llama `const ctx = await accessContext.resolve(credential.userId, preferredOrgId)` y pasa `{ sub, email, orgId: ctx.orgId, countryCode: ctx.countryCode, permissions: ctx.permissions, pv: ctx.pv }`. Propaga el resolver desde los casos de uso que llaman a `issueSession` (register, login, google, refresh).

- [ ] Claims ampliados end-to-end; `GET /auth/me` sigue funcionando; tests actuales verdes (ajusta los que asertan el shape de claims si aplica).

---

## 6. Middleware de autenticación y `require-permission`

### 6.1 `middlewares.ts` — ampliar `AuthVariables`

```ts
export type AuthVariables = {
  userId: string; email: string;
  orgId: string | null; permissions: string[]; pv: number;
};
```
En `makeAuthMiddleware`, tras verificar, setea también `orgId`, `permissions`, `pv` desde los claims.

### 6.2 Nuevo `requirePermission(perm: string)`

```ts
export function requirePermission(perm: string): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const perms = c.get('permissions') ?? [];
    if (!perms.includes(perm)) throw new ForbiddenError();
    await next();
  };
}
```
> Nota: en las rutas de administración de **auth-service**, el enforcement lo hace este middleware con el JWT que el propio auth verifica. En los servicios de negocio, el enforcement fino lee `X-Permissions` inyectado por el gateway (fuera de este repo).

- [ ] `AuthVariables` ampliado y `requirePermission` creado.

---

## 7. Casos de uso (`src/application/use-cases/`)

### 7.1 Ajustar registro y Google para crear el `User`

En `register-with-password.ts` y `login-with-google.ts`, **dentro de la `uow`**, además de crear la `Credential`, crea y guarda el `User` con el **mismo id** que `credential.userId`:
```ts
const user = User.create({ id: credential.userId, email: credential.email });
await repos.users.save(user);
```
Cambia el evento a `identity.user.created` (payload `{ userId, email }`) — ver §9. Pasa el `accessContext` a `issueSession`.

### 7.2 `SeedOrganizationRolesUseCase` (núcleo reutilizable) — nuevo

Firma: `execute({ organizationId, countryCode, name, founderUserId })`. Dentro de una `uow`:
1. Upsert `organizations` (read-model) con `countryCode`/`name`.
2. **Clona** los roles plantilla (`roles` con `organization_id NULL`) a roles de esa org (nuevo id, `organization_id = organizationId`, `is_system = true`), copiando sus `role_permissions`.
3. Crea `Membership(founderUserId, organizationId, 'active')`.
4. Asigna al fundador el rol **Administrador** de esa org (`UserRole.assign`).
5. `users.incrementPermissionsVersion(founderUserId)`.

Este caso de uso lo invocan **tanto** el consumer de `organization.org.created` (§9) como un CLI de dev.

### 7.3 `SwitchOrganizationUseCase` — nuevo

Firma: `execute({ userId, organizationId, userAgent?, ip? }) → SessionOutput`. Verifica membership activa (`NotOrganizationMemberError` si no). Reusa `issueSession` con `preferredOrgId = organizationId` (emite access nuevo + rota refresh). Devuelve `SessionOutput`.

### 7.4 Casos de uso de administración RBAC

Todos reciben el `organizationId` **del contexto** (del JWT del admin), no del body, salvo donde el recurso es global.

- `ListUsersUseCase.execute(organizationId) → UserSummary[]` (usuarios con membership en esa org).
- `InviteUserUseCase.execute({ organizationId, email, roleId }) →` crea/recupera `User` por email, crea `Membership(status:'invited'|'active')`, asigna `UserRole`, `incrementPermissionsVersion`, emite `identity.user.created` + `identity.user.role_assigned`. (El flujo de email/fijar-contraseña queda como TODO documentado; para MVP basta crear las filas.)
- `AssignRoleUseCase.execute({ organizationId, userId, roleId }) →` valida rol de la org, `UserRole.assign`, `incrementPermissionsVersion(userId)`, emite `identity.user.role_assigned`.
- `ListRolesUseCase.execute(organizationId) → Role[]` (roles de la org).
- `CreateRoleUseCase.execute({ organizationId, name, description?, permissionCodes[] }) →` crea rol de org + `setPermissions` (resuelve ids con `PermissionRepository.findIdsByCodes`).
- `UpdateRolePermissionsUseCase.execute({ organizationId, roleId, permissionCodes[] }) →` `setPermissions`, luego **pv-bump masivo**: para cada `userId` en `userRoles.listUserIdsByRole(roleId)`, `incrementPermissionsVersion`; emite `identity.role.updated`.
- `ListPermissionsUseCase.execute() → Permission[]` (catálogo global).
- (Opcional) `DisableUserUseCase.execute({ organizationId, userId })` → `user.disable()` + `incrementPermissionsVersion` + evento `identity.user.disabled`.

> Regla de dominio: no eliminar el **último Administrador** de una organización (validar en `AssignRole`/remove y `DisableUser`).

### 7.5 Perfil e identificación (activación)

`CompleteProfileUseCase.execute({ userId, fullName, identification })`: valida la identificación con el VO `Identification`, la fija en el `User` (`completeProfile`) y lo deja operativo. Reglas:

- **Fundador (self-service):** la identificación se recoge en el signup → el onboarding (`POST /signup`) la exige antes de crear la organización.
- **Google / invitado:** se crean sin identificación (Google solo da email/nombre/sub; el admin quizá no la sepa) y deben **completar perfil** antes de operar. El front bloquea el acceso mientras `identification_number` sea `null` (gate de activación), análogo al gate de `org_id = null` del §0.1.
- **Unicidad:** `(identification_type, identification_number)` único global — una persona = un usuario.
- Se expone como `POST /auth/complete-profile` (autenticado): añade su ruta en `authRoutes` y su schema en §8.1.

- [ ] Casos de uso implementados, lanzando errores de dominio apropiados.

---

## 8. Capa HTTP (`src/interface/http/`)

### 8.1 Validadores (`validators.ts`)

Añade schemas Zod: `inviteUserSchema { email, roleId }`, `assignRoleSchema { roleId }`, `createRoleSchema { name, description?, permissions: string[] }`, `updateRolePermissionsSchema { permissions: string[] }`, `switchOrgSchema { organizationId }`, `completeProfileSchema { fullName, identificationType, identificationNumber }`. Reutiliza `validateJson`.

### 8.2 Controladores (`controllers.ts`)

Factories que reciben el caso de uso (mismo patrón). Leen el `organizationId` del contexto con `c.get('orgId')` (no del body). Para rutas que requieren org activa y el usuario no la tiene (`orgId === null`) → responder `409 NO_ACTIVE_ORGANIZATION` (añade el error) o exigir `switch-organization` primero.

### 8.3 Rutas (`routes.ts` + `app.ts`)

- Amplía `AppDependencies.useCases` con los nuevos casos de uso y añade `accessContext: AccessContextResolver` a `AppDependencies`.
- `authRoutes`: añade `r.post('/switch-organization', makeAuthMiddleware(deps.tokenService), validateJson(switchOrgSchema), switchOrgController(...))`.
- Nuevas familias de rutas (montar en `app.ts` bajo los prefijos que enruta el gateway → ver `servicios/api-gateway.md`: `/users/*`, `/roles/*`, `/permissions/*`). Crea `adminRoutes(deps)` y `app.route('/', adminRoutes(deps))` con:
  ```
  GET  /users                      require('user:read')      → ListUsers
  POST /users/invite               require('user:invite')    → InviteUser
  POST /users/:id/roles            require('user:assign_role')→ AssignRole
  POST /users/:id/disable          require('user:update')    → DisableUser (opcional)
  GET  /roles                      require('user:read')      → ListRoles
  POST /roles                      require('user:assign_role')→ CreateRole
  PATCH /roles/:id/permissions     require('user:assign_role')→ UpdateRolePermissions
  GET  /permissions                (solo autenticado)        → ListPermissions
  ```
  Cada ruta protegida = `makeAuthMiddleware(deps.tokenService)` seguido de `requirePermission('...')`.
- Actualiza `cors allowMethods` en `app.ts` para incluir `PATCH` y `DELETE`.

- [ ] Rutas montadas; `openapi.yaml` actualizado con los nuevos endpoints y el nuevo shape del token.

---

## 9. Eventos (Outbox + consumer)

### 9.1 Nombres de evento (namespace `identity.*`)

Reemplaza `auth.credential.registered` por `identity.user.created`. Añade emisiones (vía `repos.outbox.add`, dentro de la misma `uow`):

| Evento | Cuándo | Payload |
|---|---|---|
| `identity.user.created` | register / google / invite | `{ userId, email }` |
| `identity.user.role_assigned` | assign role / invite | `{ userId, organizationId, roleId, pv }` |
| `identity.role.updated` | update role permissions | `{ roleId, organizationId }` |
| `identity.user.disabled` | disable user | `{ userId }` |

### 9.2 Consumer de `organization.org.created`

Crea `src/infrastructure/messaging/` con: conexión RabbitMQ (usa `RABBITMQ_URL`), un **publisher/relay** que drena `outbox_messages` (marca `processed_at`), y un **consumer** que escucha `organization.org.created` y llama a `SeedOrganizationRolesUseCase`. Payload esperado del evento: `{ organizationId, name, countryCode, founderUserId }`. Idempotencia: guarda `event_id` procesados (o usa upsert en el seed).

> **Si RabbitMQ no está disponible aún:** deja el consumer detrás de un flag (`RABBITMQ_URL` opcional). Añade también un CLI de dev `src/infrastructure/cli/seed-org.ts` (`npm run seed:org -- --org <id> --country EC --founder <userId>`) que llame al mismo `SeedOrganizationRolesUseCase`, para poder probar RBAC sin MQ. Documenta ambos caminos.

- [ ] Emisión de eventos vía Outbox integrada; consumer + CLI de seed disponibles (consumer puede quedar tras flag si MQ no está listo).

---

## 10. Composition root (`src/main.ts`) y config

- Instancia: `const accessContext = new SequelizeAccessContextResolver(repos.users, repos.memberships, sequelizeAccessQuery)`.
- Pasa `accessContext` a los casos de uso que emiten sesión (register, login, google, refresh) y a `AppDependencies`.
- Instancia y wirea los nuevos casos de uso (§7) y las nuevas rutas (§8).
- Añade a `config.ts`/`.env.example`: `RABBITMQ_URL` (opcional). No se requieren claves nuevas.
- Arranca el relay de outbox y el consumer si `RABBITMQ_URL` está definido.

- [ ] `main.ts` wirea todo; `npm run build` genera `dist/` sin errores.

---

## 11. Tests (`src/__tests__/`)

Añade, imitando los tests existentes (vitest, helpers):

- **Unit**
  - `rbac-entities.test.ts`: `User.bumpPermissionsVersion`, `Role.createForOrg`, `Membership`.
  - `seed-organization.test.ts`: clona roles plantilla → crea membership + admin + pv-bump.
  - `access-context-resolver.test.ts`: con memberships/roles fake, resuelve `orgId`, `permissions`, `pv`, `countryCode`.
  - `switch-organization.test.ts`: falla si no es miembro; emite token con el `org_id` nuevo.
  - `assign-role.test.ts` / `update-role-permissions.test.ts`: pv-bump correcto (individual y masivo).
- **e2e** (`app.e2e.test.ts` o nuevo `rbac.e2e.test.ts`)
  - Un JWT con `permissions: ['user:read']` accede a `GET /users`; sin ese permiso → `403 FORBIDDEN`.
  - `GET /auth/me` sigue devolviendo lo mismo que antes (regresión).
  - El access token emitido incluye `org_id`, `permissions`, `pv`.

- [ ] `npm test` verde (nuevos + existentes). `npm run typecheck` sin errores.

---

## 12. Definición de "hecho" (acceptance)

1. `npm run db:migrate` crea las 7 tablas + backfill + FK; el seed carga catálogo y plantillas.
2. Registrar un usuario crea fila en `users`; el JWT trae `permissions: []`, `org_id: null`, `pv: 0`.
3. Tras `SeedOrganizationRolesUseCase` (o el consumer), el fundador tiene membership + rol Administrador; su siguiente login/`switch-organization` emite un JWT con `org_id`, `permissions` completos de admin y `country_code` (si vino en el evento).
4. `GET /users` responde `200` con `user:read` en el token y `403 FORBIDDEN` sin él.
5. `PATCH /roles/:id/permissions` cambia permisos y hace `pv++` a todos los usuarios del rol.
6. `POST /auth/switch-organization` cambia la org activa del token y sus permisos.
7. Los eventos `identity.*` se escriben en `outbox_messages`.
8. Todos los tests (existentes + nuevos) pasan; `npm run build` compila.
9. La identificación `(type, number)` es única global; un usuario sin `identification_number` no puede operar (gate de activación).
10. Actualiza `README.md`: mueve de 🚧 a ✅ las filas de RBAC, permisos-en-JWT y endpoints de administración.

---

## 13. Fuera de alcance (no hacer ahora)

- Enforcement `ruta→permiso` en el **gateway** y verificación de `pv` contra caché (vive en el repo del gateway, no aquí).
- Flujo completo de invitación por email (fijar contraseña vía enlace) — dejar `InviteUser` creando las filas + evento; el correo es fase aparte.
- 2FA (TOTP). Scope de roles multipaís (`scope_type`/`scope_id`) — el modelo actual equivale a `scope = organization`; no generalizar todavía.
- Motores externos (Cerbos/OPA). No introducir.

---

## 14. Ciclo de vida: qué se crea y cuándo (Opción A)

| Evento | `User` | `Organization` (read-model auth) | `Membership` | `UserRole` | `Role` (org) |
|---|---|---|---|---|---|
| Registro (`register` / `google`) del fundador | ✅ se crea | ✅ mínima (`id`) | ✅ fundador → `active` | ✅ fundador → Administrador | ✅ clona plantillas |
| `PUT /organizations/me` (organization-service) | ❌ | — (el perfil vive en organization-service) | ❌ | ❌ | ❌ |
| Llega `organization.org.updated` (consumer auth) | ❌ | ✅ actualiza `country_code` | ❌ | ❌ | ❌ |
| `InviteUserUseCase` | ✅ si no existe por email | ❌ | ✅ `active` o `invited` | ✅ rol elegido | ❌ |
| `AssignRoleUseCase` | ❌ | ❌ | ❌ | ✅ rol elegido | ❌ |
| Login / refresh | ❌ | ❌ | ❌ | ❌ | ❌ |

**Regla mental:** en Opción A, el registro del fundador crea de una vez la identidad **y** la organización (mínima) + su rol Administrador. Lo único que falta después es el **perfil fiscal** (organization-service). La invitación ata a un empleado a una org existente.

> El texto de §7.2 (seed "invocado por el consumer de `org.created`") y §9.2 (construir un consumer de `org.created`) describen el plan anterior. En Opción A: el seed lo dispara **`register`/`google`**, y el consumer de auth escucha **`organization.org.updated`** para refrescar `country_code` (no `org.created`).

---

## 15. Orden sugerido de ejecución (para el agente)

1. Fase 1 (migración) → 2 (seed) → `db:migrate` OK.
2. Fase 3 (dominio) → 4 (persistencia) → `typecheck` OK.
3. Fase 5 (JWT/claims/resolver) → 6 (middlewares) → tests de regresión de auth verdes.
4. Fase 7 (casos de uso) → 8 (HTTP) → e2e RBAC verde.
5. Fase 9 (eventos/consumer/CLI) → 10 (wiring) → 11 (tests) → 12 (acceptance) → 9 del acceptance (flip README).

Trabaja en ramas/commits por fase. Ante cualquier ambigüedad, **prioriza imitar el archivo existente más parecido** y deja un `// TODO(rbac):` con la duda, sin romper compilación ni tests.
