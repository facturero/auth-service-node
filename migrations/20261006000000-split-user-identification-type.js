'use strict';

/**
 * `users.identification` guardaba, según quién la escribiera, dos formatos distintos:
 *   - `complete-profile`: "cedula:1710034065" (tipo + ':' + número, lo que devuelve Identification.toString()).
 *   - registro con contraseña y login con Google: el valor tal cual, sin tipo.
 * Consecuencias: texto "cedula:" a la vista en la base, un pasaporte largo ("passport:" + 20 caracteres) no cabía en el
 * VARCHAR(20), y la comprobación de duplicados (`findByIdentification('1710034065')`) no encontraba "cedula:1710034065".
 *
 * Ahora la columna guarda SOLO el número y el tipo va en `identification_type`.
 *
 * Esta migración añade la columna y reparte los valores que ya traen prefijo. Es defensiva a propósito, porque un fallo
 * aquí deja el despliegue de auth-service en Init:CrashLoopBackOff:
 *   - Una fila se deja como está (con su prefijo; el código sigue entendiéndola) si al quitarlo el número ya lo tiene otra
 *     fila, o si dos filas con prefijo darían el mismo número. Nunca se rompe la unicidad.
 *   - Es idempotente: si la columna ya existe no la vuelve a crear, y las filas ya repartidas no se tocan.
 */
const TYPES = ['cedula', 'ruc', 'passport', 'dni'];

/** "cedula:1710034065" -> { type: 'cedula', number: '1710034065' }; cualquier otra cosa -> null. */
function splitPrefixed(value) {
  if (typeof value !== 'string') return null;
  const idx = value.indexOf(':');
  if (idx === -1) return null;
  const type = value.slice(0, idx);
  const number = value.slice(idx + 1);
  if (!TYPES.includes(type) || number.length === 0) return null;
  return { type, number };
}

/**
 * Decide qué filas se reparten. `rows`: [{ id, identification }]. Devuelve { updates, skipped }:
 *   updates: [{ id, type, number }]; skipped: [{ id, identification, reason }].
 */
function planBackfill(rows) {
  const taken = new Set(rows.map((r) => r.identification));
  const candidates = [];
  for (const r of rows) {
    const parts = splitPrefixed(r.identification);
    if (parts) candidates.push({ id: r.id, identification: r.identification, ...parts });
  }
  const perNumber = new Map();
  for (const c of candidates) perNumber.set(c.number, (perNumber.get(c.number) ?? 0) + 1);

  const updates = [];
  const skipped = [];
  for (const c of candidates) {
    if (taken.has(c.number)) {
      skipped.push({ id: c.id, identification: c.identification, reason: 'otra fila ya tiene ese número sin prefijo' });
    } else if (perNumber.get(c.number) > 1) {
      skipped.push({ id: c.id, identification: c.identification, reason: 'dos filas con prefijo darían el mismo número' });
    } else {
      updates.push({ id: c.id, type: c.type, number: c.number });
    }
  }
  return { updates, skipped };
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  splitPrefixed,
  planBackfill,

  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('users');
    if (!columns.identification_type) {
      await queryInterface.addColumn('users', 'identification_type', {
        type: Sequelize.STRING(10),
        allowNull: true,
        after: 'identification',
      });
    }

    const [rows] = await queryInterface.sequelize.query(
      `SELECT id, identification FROM users WHERE identification IS NOT NULL`,
    );
    const { updates, skipped } = planBackfill(rows);

    for (const u of updates) {
      await queryInterface.sequelize.query(
        `UPDATE users SET identification_type = :type, identification = :number WHERE id = :id AND identification_type IS NULL`,
        { replacements: { id: u.id, type: u.type, number: u.number } },
      );
    }
    console.log(`[identification] ${updates.length} fila(s) repartida(s) en tipo + número; ${skipped.length} se dejan con prefijo.`);
    for (const s of skipped) console.log(`[identification]   ${s.id}: se deja "${s.identification}" (${s.reason})`);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE users SET identification = CONCAT(identification_type, ':', identification)
        WHERE identification_type IS NOT NULL AND identification IS NOT NULL
          AND CHAR_LENGTH(CONCAT(identification_type, ':', identification)) <= 20`,
    );
    await queryInterface.removeColumn('users', 'identification_type');
  },
};
