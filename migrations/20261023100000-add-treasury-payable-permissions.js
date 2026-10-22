'use strict';

const crypto = require('node:crypto');

function uuidFromCode(code) {
  const hash = crypto.createHash('md5').update(code).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
}

/**
 * Permisos del bloque D de tesorería (cuentas por pagar y pagos a proveedores). Mismo patrón que las migraciones anteriores de tesorería:
 * INSERT sobre permisos, INSERT IGNORE sobre role_permissions por NOMBRE de rol y un solo bump de permissions_version al final.
 *
 * Separación de funciones, como en compras y en cobros:
 *   - `payable:read` / `payment:read`  ver las deudas a proveedores y los pagos (Administrador, Supervisor, Contador, Solo lectura);
 *   - `payable:export`  exportar deudas, antigüedad y estado de cuenta a CSV (Administrador y Contador; es dato que SALE del sistema);
 *   - `payment:create`  crear, editar un borrador y CONTABILIZAR un pago (Administrador y Contador). No existen `payment:update` ni
 *     `payment:post`: ninguna ruta los pediría y serían permisos de adorno;
 *   - `payment:approve` aprobar un pago que llega al umbral y fijar ese umbral (solo Administrador): quien crea un pago no lo aprueba;
 *   - `payment:void`    anular un pago contabilizado, con motivo (solo Administrador).
 */
const GRANTS = {
  'payable:read':    ['Administrador', 'Supervisor', 'Contador', 'Solo lectura'],
  'payable:export':  ['Administrador', 'Contador'],
  'payment:read':    ['Administrador', 'Supervisor', 'Contador', 'Solo lectura'],
  'payment:create':  ['Administrador', 'Contador'],
  'payment:approve': ['Administrador'],
  'payment:void':    ['Administrador'],
};

const DESCRIPTIONS = {
  'payable:read':    'Ver las deudas a proveedores, su antigüedad y el estado de cuenta de un proveedor',
  'payable:export':  'Exportar las deudas a proveedores, su antigüedad y el estado de cuenta a CSV',
  'payment:read':    'Ver los pagos a proveedores',
  'payment:create':  'Registrar, editar (en borrador) y contabilizar pagos a proveedores',
  'payment:approve': 'Aprobar pagos que llegan al umbral y fijar ese umbral',
  'payment:void':    'Anular un pago contabilizado, con motivo',
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
