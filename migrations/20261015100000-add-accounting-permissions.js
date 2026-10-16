'use strict';

const crypto = require('node:crypto');

function uuidFromCode(code) {
  const hash = crypto.createHash('md5').update(code).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
}

/**
 * Permisos de la contabilidad general (accounting-service, Fase 1.1 del plan ERP). Mismo patrón que
 * 20261014100000-add-reservation-permissions.js.
 *
 * Separación de funciones a propósito: quien escribe un asiento no tiene por qué poder contabilizarlo, y contabilizar, reversar y
 * cerrar el periodo son decisiones de quien responde por los libros. Por eso:
 *   - el Supervisor puede ver y PREPARAR (crear borradores), no contabilizar;
 *   - solo el Administrador contabiliza, reversa, administra el plan de cuentas y cierra periodos.
 * Las organizaciones que tengan un contador como rol propio le asignan estos permisos desde la pantalla de roles.
 */
const GRANTS = {
  'account:read':    ['Administrador', 'Supervisor'],
  'account:manage':  ['Administrador'],
  'journal:read':    ['Administrador', 'Supervisor'],
  'journal:create':  ['Administrador', 'Supervisor'],
  'journal:post':    ['Administrador'],
  'journal:reverse': ['Administrador'],
  'period:manage':   ['Administrador'],
  'ledger:read':     ['Administrador', 'Supervisor'],
};

const DESCRIPTIONS = {
  'account:read':    'Ver el plan de cuentas, los centros de costo y los periodos contables',
  'account:manage':  'Configurar la contabilidad y administrar el plan de cuentas y los centros de costo',
  'journal:read':    'Ver los asientos contables',
  'journal:create':  'Preparar asientos contables en borrador (editarlos y eliminarlos mientras no estén contabilizados)',
  'journal:post':    'Contabilizar asientos: pasan a los libros y ya no se pueden modificar',
  'journal:reverse': 'Anular un asiento contabilizado con un asiento de reversa',
  'period:manage':   'Crear ejercicios fiscales y cerrar o reabrir periodos contables',
  'ledger:read':     'Ver el balance de comprobación y el libro mayor',
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
