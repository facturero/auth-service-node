'use strict';

const crypto = require('node:crypto');

function uuidFromCode(code) {
  const hash = crypto.createHash('md5').update(code).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
}

/**
 * Permisos del bloque E de tesorería (bancos, extractos y conciliación). Mismo patrón que las migraciones anteriores de tesorería:
 * INSERT sobre permisos, INSERT IGNORE sobre role_permissions por NOMBRE de rol y un solo bump de permissions_version al final.
 *
 *   - `bank_account:read`    ver las cuentas bancarias, sus extractos, la conciliación y el flujo de caja (y exportarlo). El saldo del banco es
 *     información sensible: Administrador, Contador y Solo lectura; no el Supervisor ni el Vendedor;
 *   - `bank_account:manage`  crear y editar cuentas, su perfil de importación, importar extractos y asignar cuenta a un movimiento (Administrador y Contador);
 *   - `reconciliation:manage` emparejar el extracto con los movimientos, marcar un renglón como contabilizado fuera de tesorería, registrar y anular
 *     ajustes bancarios (que contabilidad asienta) y cerrar o reabrir una conciliación (Administrador y Contador).
 *
 * No existen `bank_account:create|update` ni `cash_flow:read`: ninguna ruta los pediría y serían permisos de adorno.
 */
const GRANTS = {
  'bank_account:read':       ['Administrador', 'Contador', 'Solo lectura'],
  'bank_account:manage':     ['Administrador', 'Contador'],
  'reconciliation:manage':   ['Administrador', 'Contador'],
};

const DESCRIPTIONS = {
  'bank_account:read':     'Ver las cuentas bancarias, los extractos, la conciliación y el flujo de caja',
  'bank_account:manage':   'Crear y editar cuentas bancarias, importar extractos y asignar cuenta a un movimiento',
  'reconciliation:manage': 'Emparejar el extracto con los movimientos, registrar ajustes bancarios y cerrar o reabrir conciliaciones',
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
