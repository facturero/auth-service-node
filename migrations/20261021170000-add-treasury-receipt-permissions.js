'use strict';

const crypto = require('node:crypto');

function uuidFromCode(code) {
  const hash = crypto.createHash('md5').update(code).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
}

/**
 * Permisos de cobros (treasury-service, Fase 3 bloque B). Mismo patrón que `20261021130000-add-treasury-permissions.js`: INSERT sobre
 * permisos, INSERT IGNORE sobre role_permissions por NOMBRE de rol (sin filtro de organización: cubre la plantilla global y los
 * roles ya clonados por cada organización) y un solo bump de permissions_version al final.
 *
 * Separación de funciones, como en compras: quien cobra no anula lo suyo.
 *   - `receipt:read`   ver los cobros (Administrador, Supervisor, Contador, Solo lectura);
 *   - `receipt:create` crear, editar un borrador y CONTABILIZAR un cobro (Administrador, Supervisor, Contador). No existen `receipt:update`
 *     ni `receipt:post`: ninguna ruta los pediría y serían permisos de adorno en la pantalla de roles;
 *   - `receipt:void`   anular un cobro contabilizado, con motivo (solo Administrador).
 * Los roles de lectura y de contador entran desde el primer día (al Contador se le olvidó en contabilidad y no podía ni abrir el libro diario).
 */
const GRANTS = {
  'receipt:read':   ['Administrador', 'Supervisor', 'Contador', 'Solo lectura'],
  'receipt:create': ['Administrador', 'Supervisor', 'Contador'],
  'receipt:void':   ['Administrador'],
};

const DESCRIPTIONS = {
  'receipt:read':   'Ver los cobros a clientes',
  'receipt:create': 'Registrar, editar (en borrador) y contabilizar cobros a clientes',
  'receipt:void':   'Anular un cobro contabilizado, con motivo',
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

    // Quien gana permisos refresca su token una vez: el próximo request responde TOKEN_STALE y el cliente recoge los permisos nuevos.
    await queryInterface.sequelize.query(
      `UPDATE users u
          JOIN user_roles ur ON ur.user_id = u.id
          JOIN roles r ON r.id = ur.role_id
          SET u.permissions_version = u.permissions_version + 1
        WHERE r.name IN (:roleNames)`,
      { replacements: { roleNames: [...touchedRoles] } }
    );
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
    await queryInterface.sequelize.query('DELETE FROM permissions WHERE id IN (:permIds)', { replacements: { permIds } });
  },
};
