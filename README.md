# auth-service

Servicio de **autenticación** del ecosistema CRM. Responde a *"¿quién eres?"*: gestiona credenciales, emite y rota tokens (JWT), y permite **iniciar sesión o crear cuenta con Google**. No gestiona roles ni permisos (eso es de `identity-service`).

> **Alcance de este repo:** solo el **backend** del auth-service. Sin frontend. Este README y el `openapi.yaml` son documentación de diseño; el código de implementación se desarrolla aparte.

---

## Características

- Registro con **email + contraseña**.
- Inicio de sesión con **email + contraseña**.
- **Google Sign-In / Sign-Up** mediante el flujo de **ID Token** (sin `client_secret` en el backend).
- **Vinculación automática**: si el email de Google ya existe como cuenta local (y está verificado), se vincula; si no, se crea la cuenta.
- **Access token** (corta vida) + **refresh token** (larga vida) con **rotación** y **revocación**.
- `GET /auth/me` protegido por JWT.
- Publicación de eventos de dominio (patrón **Outbox**) para que el resto del sistema reaccione (ej. `identity-service` crea el perfil del usuario).

---

## Stack tecnológico

| Capa | Tecnología | Notas |
|------|------------|-------|
| Runtime | Node.js ≥ 20 | LTS |
| Lenguaje | TypeScript | `strict: true` |
| HTTP | Hono.js | framework web |
| ORM | Sequelize | acceso a MySQL |
| Base de datos | MySQL ≥ 8 | base propia: `auth_db` |
| Validación | Zod + `@hono/zod-validator` | en el borde HTTP |
| JWT | `jose` | firma/verificación, recomendado **RS256** |
| Hash de contraseñas | `argon2` (o `bcrypt`) | nunca texto plano |
| Google | `google-auth-library` | verificación del ID Token |
| Mensajería | RabbitMQ | eventos (Outbox) — opcional para arrancar |
| Contenedores | Docker / MicroK8s | despliegue |

---

## Arquitectura limpia (layer-first)

El auth-service es **un solo bounded context**, así que se organiza **por capas** con la **regla de dependencia** apuntando siempre hacia adentro:

```
domain  ←  application  ←  infrastructure
                       ←  interface
```

- **`domain`** no importa nada externo (ni Hono, ni Sequelize, ni jose). Solo entidades, value objects, errores y las **interfaces de repositorio** (puertos).
- **`application`** importa solo `domain`. Contiene los **casos de uso** y declara los **puertos de infraestructura** (hasher, token service, verificador de Google, publisher, unit of work).
- **`infrastructure`** e **`interface`** implementan esos puertos y dependen hacia adentro, nunca al revés.

Beneficio: el ORM, el verificador de Google o el hasher son **intercambiables** sin tocar la lógica de negocio. Hono vive solo en `interface/`; Sequelize solo en `infrastructure/persistence/`.

### Estructura de carpetas

```
auth-service/
├── src/
│   ├── domain/                  # centro, CERO dependencias externas
│   │   ├── entities/            # Credential, RefreshToken, OAuthAccount
│   │   ├── value-objects/       # Email, PasswordHash, UserId
│   │   ├── errors/              # InvalidCredentials, EmailAlreadyExists, ...
│   │   └── repositories/        # INTERFACES (puertos) de persistencia
│   ├── application/             # casos de uso
│   │   ├── use-cases/           # RegisterWithPassword, LoginWithPassword,
│   │   │                        #   LoginWithGoogle, RefreshToken, Logout, GetMe
│   │   ├── ports/               # INTERFACES: PasswordHasher, TokenService,
│   │   │                        #   GoogleIdTokenVerifier, EventPublisher, UnitOfWork
│   │   └── dtos/                # entrada/salida de los casos de uso
│   ├── infrastructure/          # implementaciones concretas
│   │   ├── persistence/         # Sequelize: modelos, mappers, repos, migraciones
│   │   ├── security/            # JWT (jose) + hasher (argon2)
│   │   ├── google/              # verificación del ID Token
│   │   ├── messaging/           # publisher RabbitMQ + Outbox
│   │   └── config/              # carga y validación de variables de entorno
│   ├── interface/
│   │   └── http/
│   │       ├── routes/          # rutas Hono
│   │       ├── controllers/     # request → caso de uso → response
│   │       ├── middlewares/     # auth (verifica JWT), manejo de errores
│   │       └── validators/      # esquemas Zod
│   ├── shared/                  # Result<T>, tipos comunes
│   └── main.ts                  # composition root: arma e inyecta todo
├── .env.example
├── openapi.yaml
└── README.md
```

---

## Requisitos previos

- Node.js ≥ 20 y npm
- MySQL ≥ 8 con una base `auth_db` creada
- (Opcional) RabbitMQ, si vas a publicar eventos
- Un **Client ID de Google** (Google Cloud Console → *Credentials* → *OAuth 2.0 Client ID*)

---

## Variables de entorno

Copia `.env.example` a `.env` y complétalo.

| Variable | Ejemplo | Descripción |
|----------|---------|-------------|
| `NODE_ENV` | `development` | entorno |
| `PORT` | `3001` | puerto HTTP |
| `DB_HOST` | `localhost` | host MySQL |
| `DB_PORT` | `3306` | puerto MySQL |
| `DB_USER` | `auth_user` | usuario MySQL |
| `DB_PASSWORD` | `secret` | contraseña MySQL |
| `DB_NAME` | `auth_db` | base de datos |
| `JWT_PRIVATE_KEY` | `-----BEGIN PRIVATE KEY-----...` | clave privada (firma del access token, RS256) |
| `JWT_PUBLIC_KEY` | `-----BEGIN PUBLIC KEY-----...` | clave pública (verificación; la comparten gateway/otros servicios) |
| `JWT_ACCESS_TTL` | `900` | vida del access token (segundos) |
| `JWT_REFRESH_TTL` | `2592000` | vida del refresh token (segundos) |
| `GOOGLE_CLIENT_ID` | `xxxx.apps.googleusercontent.com` | audiencia esperada del ID Token |
| `RABBITMQ_URL` | `amqp://localhost` | conexión a RabbitMQ (opcional) |
| `CORS_ORIGIN` | `http://localhost:5173` | origen permitido para el front |

> **JWT — RS256 recomendado.** Con un par de claves (privada para firmar aquí, pública para verificar en el gateway y demás servicios) ningún otro servicio necesita el secreto. Si prefieres simplicidad al arrancar, puedes usar HS256 con un único `JWT_SECRET`, pero migrar luego a RS256 implica recircular claves.

### .env.example

```dotenv
NODE_ENV=development
PORT=3001

DB_HOST=localhost
DB_PORT=3306
DB_USER=auth_user
DB_PASSWORD=secret
DB_NAME=auth_db

# RS256: pega las claves (o referencia archivos en tu loader)
JWT_PRIVATE_KEY=
JWT_PUBLIC_KEY=
JWT_ACCESS_TTL=900
JWT_REFRESH_TTL=2592000

GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com

RABBITMQ_URL=amqp://localhost
CORS_ORIGIN=http://localhost:5173
```

---

## Instalación y ejecución

Scripts esperados (los defines en tu `package.json`):

```bash
# instalar dependencias
npm install

# preparar entorno
cp .env.example .env   # y completar valores

# migraciones de base de datos (Sequelize)
npm run db:migrate

# desarrollo (con recarga)
npm run dev

# build y producción
npm run build
npm run start
```

El servicio queda escuchando en `http://localhost:3001` (según `PORT`). El contrato completo está en [`openapi.yaml`](./openapi.yaml).

---

## Modelo de datos (`auth_db`)

El auth-service **solo** guarda lo necesario para autenticar. El perfil del usuario, roles y permisos viven en `identity-service`.

```mermaid
erDiagram
    CREDENTIAL ||--o{ OAUTH_ACCOUNT : vincula
    CREDENTIAL ||--o{ REFRESH_TOKEN : emite

    CREDENTIAL {
        char36 id PK
        char36 user_id "identidad de negocio (sub del JWT)"
        string email UK
        string password_hash "NULL si la cuenta es solo-Google"
        bool email_verified
        enum status "active|disabled"
        datetime created_at
        datetime updated_at
    }
    OAUTH_ACCOUNT {
        char36 id PK
        char36 credential_id FK
        string provider "google"
        string provider_user_id "el 'sub' de Google"
        string email "email del proveedor"
        datetime created_at
    }
    REFRESH_TOKEN {
        char36 id PK
        char36 credential_id FK
        string token_hash "se guarda el hash, NO el token"
        datetime expires_at
        datetime revoked_at "NULL si activo"
        char36 replaced_by "rotación (cadena)"
        string user_agent "auditoría de sesión (opcional)"
        string ip "auditoría de sesión (opcional)"
        datetime created_at
    }
    OUTBOX_MESSAGE {
        char36 id PK
        string aggregate_type "credential"
        char36 aggregate_id
        string type "auth.credential.registered"
        json payload
        datetime occurred_at
        datetime processed_at "NULL hasta publicar"
    }
    LOGIN_ATTEMPT {
        char36 id PK
        string email
        string ip
        bool success
        datetime created_at
    }
```

Notas de diseño:

- **`password_hash` es `NULL`** para cuentas creadas solo con Google. Una cuenta puede tener ambos: contraseña **y** Google vinculado.
- **Constraint único** `(provider, provider_user_id)` en `OAUTH_ACCOUNT` evita duplicar la cuenta Google.
- **Refresh tokens hasheados**: nunca se almacena el token en claro; se guarda su hash. `replaced_by` encadena la rotación.
- **`user_id`** lo genera auth-service al registrar y se publica por evento; es el `sub` del JWT y la clave con la que el resto del sistema referencia a la persona.
- `LOGIN_ATTEMPT` es opcional, para rate-limit / bloqueo temporal por intentos fallidos.

---

## Endpoints

| Método | Ruta | Protegido | Descripción |
|--------|------|-----------|-------------|
| `GET` | `/health` | no | healthcheck |
| `POST` | `/auth/register` | no | crear cuenta con email + contraseña |
| `POST` | `/auth/login` | no | iniciar sesión con email + contraseña |
| `POST` | `/auth/google` | no | iniciar sesión o crear cuenta con ID Token de Google |
| `POST` | `/auth/refresh` | no | obtener un nuevo access token (rota el refresh) |
| `POST` | `/auth/logout` | no | revocar un refresh token |
| `GET` | `/auth/me` | **sí** (Bearer) | datos de la sesión actual |

Detalle de cuerpos, códigos y ejemplos en [`openapi.yaml`](./openapi.yaml).

---

## Flujos de autenticación

### Registro con email + contraseña

```mermaid
sequenceDiagram
    participant C as Cliente
    participant A as auth-service
    participant DB as auth_db
    C->>A: POST /auth/register {email, password}
    A->>A: valida (Zod) + verifica email no existente
    A->>A: hash de la contraseña (argon2)
    A->>DB: crea CREDENTIAL (genera user_id) + fila en OUTBOX
    A->>A: emite access + refresh (guarda hash del refresh)
    A-->>C: 201 {accessToken, refreshToken, user}
```

### Login con email + contraseña

```mermaid
sequenceDiagram
    participant C as Cliente
    participant A as auth-service
    C->>A: POST /auth/login {email, password}
    A->>A: busca credencial + verifica hash
    alt válido
        A-->>C: 200 {accessToken, refreshToken, user}
    else inválido
        A-->>C: 401 InvalidCredentials
    end
```

### Google Sign-In / Sign-Up (flujo ID Token)

El **frontend** obtiene el ID Token con Google Identity Services y lo envía. El backend lo **verifica** (firma contra los certificados de Google, `aud == GOOGLE_CLIENT_ID`, emisor y expiración). **No** se usa `client_secret` aquí.

```mermaid
sequenceDiagram
    participant C as Cliente (front)
    participant A as auth-service
    participant G as Google (verificación)
    participant DB as auth_db
    C->>A: POST /auth/google {idToken}
    A->>G: verifica firma + aud + exp
    G-->>A: payload {sub, email, email_verified, name}
    alt ya existe OAUTH_ACCOUNT (google, sub)
        A->>DB: lee credencial
    else email ya existe como cuenta local (verificado)
        A->>DB: vincula → crea OAUTH_ACCOUNT
    else no existe
        A->>DB: crea CREDENTIAL (password NULL) + OAUTH_ACCOUNT + OUTBOX
    end
    A->>A: emite access + refresh
    A-->>C: 200 {accessToken, refreshToken, user}
```

Reglas de la vinculación:

- Si el `sub` de Google ya está registrado → **login** directo.
- Si el email del token **ya existe** como cuenta local y `email_verified == true` → **se vincula** (se añade `OAUTH_ACCOUNT`).
- Si no existe → **se crea** la cuenta (sin contraseña) y se emite el evento de registro.

### Refresh (rotación)

```mermaid
sequenceDiagram
    participant C as Cliente
    participant A as auth-service
    participant DB as auth_db
    C->>A: POST /auth/refresh {refreshToken}
    A->>DB: busca por hash → valida no expirado / no revocado
    A->>DB: revoca el actual + crea uno nuevo (replaced_by)
    A->>A: emite nuevo access token
    A-->>C: 200 {accessToken, refreshToken}
```

Si el refresh ya fue usado (detección de reuso por la cadena `replaced_by`), se considera comprometido y se recomienda **revocar toda la cadena**.

### Logout

```mermaid
sequenceDiagram
    participant C as Cliente
    participant A as auth-service
    C->>A: POST /auth/logout {refreshToken}
    A->>A: marca revoked_at en el refresh token
    A-->>C: 204
```

---

## Contenido del token

- **Access token (JWT, RS256, corta vida ~15 min)** — claims sugeridos: `sub` (user_id), `email`, `iat`, `exp`, `token_use=access`. Más adelante incluirá los **permisos** del usuario, alimentados por el read-model que escucha a `identity-service`.
- **Refresh token (larga vida ~30 días)** — cadena **opaca aleatoria**; en la base solo vive su **hash**. Se **rota** en cada uso.

El **gateway** y los demás servicios verifican el access token con la **clave pública** (`JWT_PUBLIC_KEY`), sin contactar al auth-service en el camino crítico.

---

## Seguridad

- Contraseñas con **argon2** (o bcrypt); jamás en texto plano.
- Refresh tokens **hasheados** en reposo; rotación + detección de reuso.
- **RS256** para que la verificación sea descentralizada (clave pública compartida).
- Validación estricta del **ID Token** de Google: firma, `aud`, `iss`, `exp`.
- `email_verified` se respeta antes de vincular cuentas por email.
- (Opcional) rate-limit / bloqueo temporal vía `LOGIN_ATTEMPT`.
- CORS restringido a `CORS_ORIGIN`.
- Respuestas de error **genéricas** en login (no revelar si el email existe).

---

## Eventos publicados (integración)

Vía patrón **Outbox** (tabla `OUTBOX_MESSAGE` → publisher a RabbitMQ):

| Evento | Cuándo | Consumido por |
|--------|--------|---------------|
| `auth.credential.registered` | Nueva cuenta creada (password o Google) | `identity-service` (crea el perfil del usuario) |
| `auth.credential.linked_google` | Se vincula Google a una cuenta existente | auditoría |
| `auth.session.refreshed` | Se rota un refresh token | auditoría (opcional) |

> En el diseño global, `identity-service` consume `auth.credential.registered` para crear el usuario de negocio con su `user_id`. Mientras `identity-service` no exista, el auth-service funciona de forma autónoma emitiendo los eventos para su consumo posterior.

---

## Convenciones

- **Clean Architecture**: la dependencia siempre apunta hacia adentro; el dominio no conoce frameworks.
- **Una base de datos propia** (`auth_db`); no se accede a tablas de otros servicios.
- Eventos nombrados en **pasado**: `auth.credential.registered`.
- Validación en el **borde** con Zod; invariantes en el **dominio**.
- Errores con cuerpo estándar `{ code, message, details? }` (ver `openapi.yaml`).
