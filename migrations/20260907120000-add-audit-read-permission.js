'use strict';

const crypto = require('node:crypto');

function uuidFromCode(code) {
  const hash = crypto.createHash('md5').update(code).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
}

/**
 * Retroactivo de `audit:read` (el seed 20260702130000 ya corrió en producción y
 * sequelize_meta no lo vuelve a ejecutar).
 *
 * - Inserta el permiso en el catálogo (el mismo uuid v5-md5 del seed: 'audit:read').
 * - Lo concede a los roles que lo reciben por diseño (Administrador lo hereda
 *   "todos"; Solo lectura filtra *:read; Supervisor y Contador lo añaden).
 *   Sin filtro de organization_id: cubre tanto las plantillas globales como
 *   los roles clonados por cada organización.
 * - Bumpea permissions_version SOLO a usuarios con esos roles: el próximo
 *   request del gateway responde TOKEN_STALE → el cliente refresca y el claim
 *   permissions ya trae audit:read.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const code = 'audit:read';
    const [resource, action] = code.split(':');
    const permId = uuidFromCode(code);

    await queryInterface.sequelize.query(
      `INSERT INTO permissions (id, code, resource, action, description)
       VALUES (:id, :code, :resource, :action, NULL)
       ON DUPLICATE KEY UPDATE code = code`,
      { replacements: { id: permId, code, resource, action }, type: Sequelize.QueryTypes.INSERT }
    );

    const roleNames = ['Administrador', 'Contador', 'Solo lectura', 'Supervisor'];

    await queryInterface.sequelize.query(
      `INSERT IGNORE INTO role_permissions (role_id, permission_id)
       SELECT r.id, :permId
       FROM roles r
       WHERE r.name IN (:roleNames)`,
      { replacements: { permId, roleNames } }
    );

    // Solo quienes ganan el permiso: evita forzar re-login masivo a los demás.
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
    const permId = uuidFromCode('audit:read');
    await queryInterface.sequelize.query(
      `DELETE rp FROM role_permissions rp
       WHERE rp.permission_id = :permId`,
      { replacements: { permId } }
    );
    await queryInterface.sequelize.query(
      `DELETE FROM permissions WHERE id = :permId`,
      { replacements: { permId } }
    );
  },
};