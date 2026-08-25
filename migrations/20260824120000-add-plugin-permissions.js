'use strict';

const crypto = require('node:crypto');

function uuidFromCode(code) {
  const hash = crypto.createHash('md5').update(code).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
}

const ALL_TEMPLATE_IDS = [
  '00000000-0000-4000-a000-000000000001',
  '00000000-0000-4000-a000-000000000002',
  '00000000-0000-4000-a000-000000000003',
  '00000000-0000-4000-a000-000000000004',
  '00000000-0000-4000-a000-000000000005',
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const perms = [
      { code: 'plugins:read',   resource: 'plugins', action: 'read',   desc: 'Ver catálogo de plugins y sus activaciones', roles: ALL_TEMPLATE_IDS },
      { code: 'plugins:manage', resource: 'plugins', action: 'manage', desc: 'Activar/desactivar plugins y solicitar plugins a medida', roles: [ALL_TEMPLATE_IDS[0], ALL_TEMPLATE_IDS[4]] },
      { code: 'plugins:admin',  resource: 'plugins', action: 'admin',  desc: 'Atender solicitudes de plugins a medida (fulfill/reject)', roles: [ALL_TEMPLATE_IDS[0]] },
    ];

    for (const p of perms) {
      const permId = uuidFromCode(p.code);

      await queryInterface.sequelize.query(
        `INSERT IGNORE INTO permissions (id, code, resource, action, description)
         VALUES (:id, :code, :resource, :action, :desc)`,
        { replacements: { id: permId, code: p.code, resource: p.resource, action: p.action, desc: p.desc } }
      );

      for (const roleId of p.roles) {
        await queryInterface.sequelize.query(
          `INSERT IGNORE INTO role_permissions (role_id, permission_id)
           VALUES (:roleId, :permId)`,
          { replacements: { roleId, permId } }
        );
      }

      await queryInterface.sequelize.query(
        `INSERT IGNORE INTO role_permissions (role_id, permission_id)
         SELECT r.id, :permId
         FROM roles r
         WHERE r.name IN ('Administrador', 'Vendedor', 'Contador', 'Solo lectura', 'Supervisor')
           AND r.organization_id IS NOT NULL
           AND :hasRead`,
        {
          replacements: {
            permId,
            hasRead: p.code === 'plugins:read' ? 1 : 0,
          }
        }
      );
    }
  },

  async down(queryInterface) {
    function uuid(code) {
      const hash = require('node:crypto').createHash('md5').update(code).digest('hex');
      return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
    }

    for (const code of ['plugins:read', 'plugins:manage', 'plugins:admin']) {
      const permId = uuid(code);
      await queryInterface.sequelize.query(
        `DELETE FROM role_permissions WHERE permission_id = :permId`,
        { replacements: { permId } }
      );
      await queryInterface.sequelize.query(
        `DELETE FROM permissions WHERE id = :permId`,
        { replacements: { permId } }
      );
    }
  },
};
