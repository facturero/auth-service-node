'use strict';

const crypto = require('node:crypto');

function uuidFromCode(code) {
  const hash = crypto.createHash('md5').update(code).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
}

/**
 * Permisos de factura de compra (conciliación a tres vías, Fase 2.2b).
 *
 * Separación de funciones:
 *   - Supervisor: crea y edita borradores, contabiliza (post).
 *   - Administrador: todo lo anterior + aprueba con excepción (override), anula (void).
 *
 * El permiso `purchase_bill:create_unmatched` permite crear facturas sin orden asociada.
 */
const GRANTS = {
  'purchase_bill:read':      ['Administrador', 'Supervisor'],
  'purchase_bill:create':    ['Administrador', 'Supervisor'],
  'purchase_bill:create_unmatched': ['Administrador'],
  'purchase_bill:override':  ['Administrador'],
  'purchase_bill:void':      ['Administrador'],
};

const DESCRIPTIONS = {
  'purchase_bill:read':          'Ver las facturas de compra y su conciliación',
  'purchase_bill:create':        'Crear, editar y contabilizar facturas de compra (con orden)',
  'purchase_bill:create_unmatched': 'Crear facturas de compra sin orden asociada',
  'purchase_bill:override':      'Aprobar con excepción una factura bloqueada por conciliación',
  'purchase_bill:void':          'Anular una factura de compra contabilizada o bloqueada',
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

    // Bump de versión de permisos para roles afectados
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