'use strict';

const crypto = require('node:crypto');

function uuidFromCode(code) {
  const hash = crypto.createHash('md5').update(code).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
}

/**
 * Permiso del terminal POS. Mismo patrón que 20260910130000-add-inventory-permissions.js.
 *
 * `pos:access` decide quién puede entrar a una caja POS y cobrar. Lo declara el proyecto POS
 * (pos/backend/src/sync/permissions.ts) y el CRM lo asigna a roles como cualquier otro permiso: la caja recibe a cada
 * usuario con sus permisos (GET /users) y no mira nombres de rol ni permisos de facturas.
 *
 * Quién lo tiene por defecto = quién cobraba hasta hoy: Administrador, Supervisor y Vendedor. NO lo tienen Contador ni
 * Solo lectura (solo leen facturas). Los roles personalizados no lo reciben: se les da desde el editor de roles.
 */
const GRANTS = {
  'pos:access': ['Administrador', 'Supervisor', 'Vendedor'],
};

const DESCRIPTIONS = {
  'pos:access': 'Entrar a la caja POS y cobrar',
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

      // Sin filtro de organization_id: cubre las plantillas globales y los roles ya clonados por cada organización.
      await queryInterface.sequelize.query(
        `INSERT IGNORE INTO role_permissions (role_id, permission_id)
         SELECT r.id, :permId
         FROM roles r
         WHERE r.name IN (:roleNames)`,
        { replacements: { permId, roleNames } }
      );

      for (const r of roleNames) touchedRoles.add(r);
    }

    // Quien gana el permiso refresca su token una vez (TOKEN_STALE) y recoge los permisos nuevos.
    const roleNames = [...touchedRoles];
    await queryInterface.sequelize.query(
      `UPDATE users u
          JOIN user_roles ur ON ur.user_id = u.id
          JOIN roles r ON r.id = ur.role_id
          SET u.permissions_version = u.permissions_version + 1
        WHERE r.name IN (:roleNames)`,
      { replacements: { roleNames } }
    );
  },

  async down(queryInterface) {
    const permIds = Object.keys(GRANTS).map(uuidFromCode);
    await queryInterface.sequelize.query(
      `DELETE FROM role_permissions WHERE permission_id IN (:permIds)`,
      { replacements: { permIds } }
    );
    await queryInterface.sequelize.query(
      `DELETE FROM permissions WHERE id IN (:permIds)`,
      { replacements: { permIds } }
    );
  },
};
