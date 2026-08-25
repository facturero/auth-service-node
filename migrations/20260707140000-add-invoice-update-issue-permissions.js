/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    function uuidFromCode(code) {
      const hash = require('node:crypto').createHash('md5').update(code).digest('hex');
      return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
    }

    const ADMIN_TEMPLATE_ID = '00000000-0000-4000-a000-000000000001';
    const VENDOR_TEMPLATE_ID = '00000000-0000-4000-a000-000000000002';
    const SUPERVISOR_TEMPLATE_ID = '00000000-0000-4000-a000-000000000005';

    const perms = [
      { code: 'invoice:update', resource: 'invoice', action: 'update', desc: 'Actualizar facturas' },
      { code: 'invoice:issue',  resource: 'invoice', action: 'issue',  desc: 'Emitir facturas' },
    ];

    for (const p of perms) {
      const permId = uuidFromCode(p.code);

      await queryInterface.sequelize.query(
        `INSERT IGNORE INTO permissions (id, code, resource, action, description)
         VALUES (:id, :code, :resource, :action, :desc)`,
        { replacements: { id: permId, code: p.code, resource: p.resource, action: p.action, desc: p.desc } }
      );

      // Asignar a templates (nuevas organizaciones)
      for (const roleId of [ADMIN_TEMPLATE_ID, VENDOR_TEMPLATE_ID, SUPERVISOR_TEMPLATE_ID]) {
        await queryInterface.sequelize.query(
          `INSERT IGNORE INTO role_permissions (role_id, permission_id)
           VALUES (:roleId, :permId)`,
          { replacements: { roleId, permId } }
        );
      }

      // Asignar retroactivamente a roles existentes
      await queryInterface.sequelize.query(
        `INSERT IGNORE INTO role_permissions (role_id, permission_id)
         SELECT r.id, :permId
         FROM roles r
         WHERE r.name IN ('Administrador', 'Vendedor', 'Supervisor')
           AND r.organization_id IS NOT NULL`,
        { replacements: { permId } }
      );
    }
  },

  async down(queryInterface, Sequelize) {
    function uuidFromCode(code) {
      const hash = require('node:crypto').createHash('md5').update(code).digest('hex');
      return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
    }

    for (const code of ['invoice:update', 'invoice:issue']) {
      const permId = uuidFromCode(code);
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
