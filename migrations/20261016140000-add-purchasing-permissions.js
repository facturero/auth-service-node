'use strict';

const crypto = require('node:crypto');

function uuidFromCode(code) {
  const hash = crypto.createHash('md5').update(code).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
}

/**
 * Permisos de compras (purchasing-service, Fase 2.1 del plan ERP). Mismo patrón que 20261015100000-add-accounting-permissions.js.
 *
 * Separación de funciones a propósito: quien prepara una orden de compra no la aprueba, y cancelar una orden YA aprobada (un
 * compromiso con el proveedor) es una decisión aparte.
 *   - el Supervisor ve y mantiene proveedores, y prepara y envía órdenes;
 *   - solo el Administrador aprueba, rechaza, cancela lo aprobado y fija la política de aprobación (el monto desde el cual se exige).
 * Las organizaciones con un jefe de compras como rol propio le asignan estos permisos desde la pantalla de roles.
 */
const GRANTS = {
  'supplier:read':     ['Administrador', 'Supervisor'],
  'supplier:manage':   ['Administrador', 'Supervisor'],
  'purchase:read':     ['Administrador', 'Supervisor'],
  'purchase:create':   ['Administrador', 'Supervisor'],
  'purchase:approve':  ['Administrador'],
  'purchase:cancel':   ['Administrador'],
};

const DESCRIPTIONS = {
  'supplier:read':    'Ver los proveedores',
  'supplier:manage':  'Crear, editar y desactivar proveedores',
  'purchase:read':    'Ver las órdenes de compra y la política de aprobación',
  'purchase:create':  'Preparar, enviar y cancelar (si no están aprobadas) órdenes de compra',
  'purchase:approve': 'Aprobar o rechazar órdenes de compra y fijar el monto desde el cual se exige aprobación',
  'purchase:cancel':  'Cancelar órdenes de compra ya aprobadas',
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

    // Un solo bump al final: quien gana algo refresca una vez. El próximo request responde TOKEN_STALE y el cliente recoge los permisos.
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
