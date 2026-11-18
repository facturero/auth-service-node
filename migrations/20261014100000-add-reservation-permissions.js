'use strict';

const crypto = require('node:crypto');

function uuidFromCode(code) {
  const hash = crypto.createHash('md5').update(code).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
}

/**
 * Permisos de las reservas del restaurante (restaurant-service, entregable 2). Mismo patrón que
 * 20261013120000-add-restaurant-permissions.js.
 *
 * Aparte de `restaurant:*` (que cubre el mapa, las mesas y los horarios) porque quien recibe a los clientes no tiene por qué
 * poder mover paredes, y quien edita el plano no tiene por qué ver los teléfonos de los clientes. Las rutas de reservas piden
 * `reservation:read` / `reservation:manage`; las rutas públicas del cliente final no piden nada.
 *
 * Gestionar reservas (anotarlas, sentar, cancelar) es trabajo de servicio de sala, no solo del administrador: lo reciben también
 * Supervisor y Vendedor. Ajustar la página pública y los límites de reserva sí lo hace quien tenga `reservation:manage`; si el
 * negocio quiere separarlo, se hace con un permiso nuevo (hoy no hay motivo).
 */
const GRANTS = {
  'reservation:read':   ['Administrador', 'Supervisor', 'Vendedor', 'Solo lectura'],
  'reservation:manage': ['Administrador', 'Supervisor', 'Vendedor'],
};

const DESCRIPTIONS = {
  'reservation:read':   'Ver las reservas del restaurante y sus ajustes',
  'reservation:manage': 'Anotar, sentar y cancelar reservas, y ajustar la página de reservas',
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

    // Un solo bump al final: quien gana algo refresca una vez.
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
