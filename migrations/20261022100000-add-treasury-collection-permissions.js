'use strict';

const crypto = require('node:crypto');

function uuidFromCode(code) {
  const hash = crypto.createHash('md5').update(code).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
}

/**
 * Permisos del bloque C de tesorería (exportar y recordatorios). Mismo patrón que las migraciones anteriores de tesorería: INSERT sobre
 * permisos, INSERT IGNORE sobre role_permissions por NOMBRE de rol y un solo bump de permissions_version al final.
 *
 *   - `receivable:export` exportar la cartera, la antigüedad y el estado de cuenta a CSV (Administrador y Contador). Aparte de
 *     `receivable:read` porque es dato que SALE del sistema: cada archivo deja un evento en la bitácora.
 *   - `reminder:manage`   encender, apagar y ajustar los recordatorios de cobro, ver a quién se avisaría y enviarlos ahora (solo
 *     Administrador). Un recordatorio es un correo al CLIENTE de la organización (comunicación externa): no se delega por defecto.
 */
const GRANTS = {
  'receivable:export': ['Administrador', 'Contador'],
  'reminder:manage':   ['Administrador'],
};

const DESCRIPTIONS = {
  'receivable:export': 'Exportar la cartera, la antigüedad y el estado de cuenta a CSV',
  'reminder:manage':   'Configurar y enviar los recordatorios de cobro a clientes',
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
         AND r.name IN ('Administrador','Contador')`,
      { replacements: { permIds } }
    );
    await queryInterface.sequelize.query('DELETE FROM permissions WHERE id IN (:permIds)', { replacements: { permIds } });
  },
};
