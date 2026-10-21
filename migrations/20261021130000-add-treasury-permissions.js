'use strict';

const crypto = require('node:crypto');

function uuidFromCode(code) {
  const hash = crypto.createHash('md5').update(code).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
}

/**
 * Permisos de tesorería/cartera (treasury-service, Fase 3 bloque A). Mismo patrón que las migraciones anteriores:
 * INSERT IGNORE sobre permisos, INSERT IGNORE sobre role_permissions por nombre de rol (sin filtro de organización) y un solo
 * bump de permissions_version al final.
 *
 * Solo se conceden los permisos que TIENEN ruta en el bloque A: `receivable:read`, `customer_terms:manage`,
 * `opening_balance:load`. `receipt:*` y los de pagos/conciliación van en su propio bloque cuando haya rutas que los exijan
 * (ver IMPLEMENTATION.md R.1).
 *
 * Contador y Solo lectura se añaden desde el primer día (se vio que solo Administrador/Supervisor los dejaba fuera).
 */
const GRANTS = {
  'receivable:read':      ['Administrador', 'Supervisor', 'Contador', 'Solo lectura'],
  'customer_terms:manage':['Administrador', 'Contador'],
  'opening_balance:load': ['Administrador'],
};

const DESCRIPTIONS = {
  'receivable:read':       'Ver cartera, antigüedad de cartera y estado de cuenta',
  'customer_terms:manage': 'Cambiar días de crédito y cupo de crédito de un cliente',
  'opening_balance:load':  'Cargar saldos iniciales de cartera con fecha de corte',
};

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const touchedRoles = new Set();

    for (const [code, roleNames] of Object.entries(GRANTS)) {
      const [resource, action] = code.split(':');
      const permId = uuidFromCode(code);

      await queryInterface.sequelize.query(
        `INSERT INTO permissions (id, code, resource, action, description)
         VALUES (:id, :code, :resource, :action, :description)
         ON DUPLICATE KEY UPDATE description = VALUES(description)`,
        { replacements: { id: permId, code, resource, action, description: DESCRIPTIONS[code] ?? null }, type: Sequelize.QueryTypes.INSERT }
      );

      await queryInterface.sequelize.query(
        `INSERT IGNORE INTO role_permissions (role_id, permission_id)
         SELECT r.id, :permId
         FROM roles r
         WHERE r.name IN (:roleNames)`,
        { replacements: { permId, roleNames } }
      );

      for (const r of roleNames) touchedRoles.add(r);
    }

    const roleNames = [...touchedRoles];
    if (roleNames.length) {
      await queryInterface.sequelize.query(
        `UPDATE users u
            JOIN user_roles ur ON ur.user_id = u.id
            JOIN roles r ON r.id = ur.role_id
           SET u.permissions_version = u.permissions_version + 1
         WHERE r.name IN (:roleNames)`,
        { replacements: { roleNames } }
      );
    }
  },

  async down(queryInterface) {
    const permIds = Object.keys(GRANTS).map(uuidFromCode);
    await queryInterface.sequelize.query(
      `DELETE rp FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
       WHERE rp.permission_id IN (:permIds)
         AND r.name IN ('Administrador','Supervisor','Contador','Solo lectura')`,
      { replacements: { permIds } }
    );
    await queryInterface.sequelize.query(
      `DELETE FROM permissions WHERE id IN (:permIds)`,
      { replacements: { permIds } }
    );
  },
};
