'use strict';

const crypto = require('node:crypto');

function uuidFromCode(code) {
  const hash = crypto.createHash('md5').update(code).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
}

/**
 * Permisos de inventory-service. Mismo patrón que
 * 20260907120000-add-audit-read-permission.js.
 *
 * El gateway valida ruta→permiso ANTES de enrutar, así que sin estas filas
 * todas las rutas de /warehouses y /stock responden 403 aunque el servicio
 * esté sano. Ver inventory-service/IMPLEMENTATION.md, fase 0.1.
 *
 * `inventory:reserve` se siembra aunque el flujo de reserva sea fase 2: las
 * rutas no se montan todavía, pero sembrarlo ahora evita volver a tocar auth
 * (y a forzar otro bump de permissions_version) cuando se monten.
 */
const GRANTS = {
  'inventory:read':      ['Administrador', 'Supervisor', 'Contador', 'Solo lectura'],
  'inventory:manage':    ['Administrador'],
  'inventory:adjust':    ['Administrador', 'Supervisor'],
  'inventory:transfer':  ['Administrador', 'Supervisor'],
  'inventory:reserve':   ['Administrador'],
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
         VALUES (:id, :code, :resource, :action, NULL)
         ON DUPLICATE KEY UPDATE code = code`,
        { replacements: { id: permId, code, resource, action }, type: Sequelize.QueryTypes.INSERT }
      );

      // Sin filtro de organization_id: cubre las plantillas globales y los
      // roles ya clonados por cada organización.
      await queryInterface.sequelize.query(
        `INSERT IGNORE INTO role_permissions (role_id, permission_id)
         SELECT r.id, :permId
         FROM roles r
         WHERE r.name IN (:roleNames)`,
        { replacements: { permId, roleNames } }
      );

      for (const r of roleNames) touchedRoles.add(r);
    }

    // Un solo bump al final: quien gana algo refresca una vez, no cinco.
    // El próximo request responde TOKEN_STALE y el cliente recoge los permisos.
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
