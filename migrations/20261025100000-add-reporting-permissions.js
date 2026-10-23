'use strict';

const crypto = require('node:crypto');

function uuidFromCode(code) {
  const hash = crypto.createHash('md5').update(code).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
}

/**
 * Permisos de los anexos del SRI (`reporting-service`, módulo `compliance.sri_annexes`). Mismo patrón que las migraciones de tesorería:
 * INSERT sobre permisos, INSERT IGNORE sobre role_permissions por NOMBRE de rol y un solo bump de permissions_version al final.
 *
 *   - `tax_annex:read`     ver los anexos generados, sus hallazgos, los comprobantes que los alimentan y la conciliación con el libro mayor.
 *     Son datos tributarios de toda la organización: Administrador, Contador y Solo lectura; no el Supervisor ni el Vendedor;
 *   - `tax_annex:generate` generar una versión nueva de un anexo y completar sus casilleros manuales (Administrador y Contador);
 *   - `tax_annex:export`   descargar el anexo (Administrador y Contador). Aparte de generar a propósito: descargar saca la información
 *     de la aplicación, y quien prepara un anexo no siempre debe poder llevárselo.
 *
 * Los tres los exige alguna ruta de `reporting-service` (y del gateway): no hay permisos de adorno.
 */
const GRANTS = {
  'tax_annex:read':     ['Administrador', 'Contador', 'Solo lectura'],
  'tax_annex:generate': ['Administrador', 'Contador'],
  'tax_annex:export':   ['Administrador', 'Contador'],
};

const DESCRIPTIONS = {
  'tax_annex:read':     'Ver los anexos del SRI (ATS, formularios 103 y 104), sus hallazgos y su conciliación con el libro mayor',
  'tax_annex:generate': 'Generar una versión de un anexo del SRI y completar sus casilleros manuales',
  'tax_annex:export':   'Descargar los anexos del SRI',
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
