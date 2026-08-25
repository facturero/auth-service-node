'use strict';

const crypto = require('node:crypto');

function uuidFromCode(code) {
  const hash = crypto.createHash('md5').update(code).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // La migración previo (20260824120000) asignó plugins:manage/plugins:admin
    // solo a las plantillas globales; los roles clonados por cada organización
    // recibieron únicamente plugins:read. Este backfill completa los clonados.
    const grants = [
      {
        code: 'plugins:manage',
        roleNames: ['Administrador', 'Supervisor'],
        desc: 'Activar/desactivar plugins y solicitar plugins a medida',
      },
      {
        code: 'plugins:admin',
        roleNames: ['Administrador'],
        desc: 'Atender solicitudes de plugins a medida (fulfill/reject)',
      },
    ];

    for (const g of grants) {
      const permId = uuidFromCode(g.code);

      await queryInterface.sequelize.query(
        `INSERT IGNORE INTO role_permissions (role_id, permission_id)
         SELECT r.id, :permId
         FROM roles r
         WHERE r.name IN (:roleNames)
           AND r.organization_id IS NOT NULL`,
        { replacements: { permId, roleNames: g.roleNames } }
      );
    }

    // Fuerza la renovación del claim `permissions` en el próximo login.
    await queryInterface.sequelize.query(
      `UPDATE users
          SET permissions_version = permissions_version + 1
        WHERE id IN (SELECT DISTINCT ur.user_id FROM user_roles ur)`
    );
  },

  async down(queryInterface) {
    function uuid(code) {
      const hash = require('node:crypto').createHash('md5').update(code).digest('hex');
      return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
    }

    const manageId = uuid('plugins:manage');
    const adminId = uuid('plugins:admin');

    await queryInterface.sequelize.query(
      `DELETE rp FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       WHERE rp.permission_id IN (:manageId, :adminId)
         AND r.organization_id IS NOT NULL`,
      { replacements: { manageId, adminId } }
    );
  },
};
