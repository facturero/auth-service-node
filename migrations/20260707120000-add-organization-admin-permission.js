/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Insertar el permiso organization:admin si no existe
    const NAMESPACE = '00000000-0000-0000-0000-000000000000';
    function uuidFromCode(code) {
      const hash = require('node:crypto').createHash('md5').update(code).digest('hex');
      return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
    }
    const permissionId = uuidFromCode('organization:admin');
    const ADMIN_TEMPLATE_ID = '00000000-0000-4000-a000-000000000001';

    await queryInterface.sequelize.query(
      `INSERT IGNORE INTO permissions (id, code, resource, action, description)
       VALUES (:id, 'organization:admin', 'organization', 'admin', 'Acceso de administrador a la organización')`,
      { replacements: { id: permissionId }, type: Sequelize.QueryTypes.INSERT }
    );

    // 2. Asignar al template de Administrador (para nuevas organizaciones)
    await queryInterface.sequelize.query(
      `INSERT IGNORE INTO role_permissions (role_id, permission_id)
       VALUES (:roleId, :permId)`,
      { replacements: { roleId: ADMIN_TEMPLATE_ID, permId: permissionId }, type: Sequelize.QueryTypes.INSERT }
    );

    // 3. Asignar a todos los roles Administrador existentes (organizaciones ya creadas)
    await queryInterface.sequelize.query(
      `INSERT IGNORE INTO role_permissions (role_id, permission_id)
       SELECT r.id, :permId
       FROM roles r
       WHERE r.name = 'Administrador'
         AND r.organization_id IS NOT NULL`,
      { replacements: { permId: permissionId }, type: Sequelize.QueryTypes.INSERT }
    );
  },

  async down(queryInterface, Sequelize) {
    const permissionId = (() => {
      const hash = require('node:crypto').createHash('md5').update('organization:admin').digest('hex');
      return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
    })();

    await queryInterface.sequelize.query(
      `DELETE FROM role_permissions WHERE permission_id = :permId`,
      { replacements: { permId: permissionId }, type: Sequelize.QueryTypes.DELETE }
    );
    await queryInterface.sequelize.query(
      `DELETE FROM permissions WHERE id = :permId`,
      { replacements: { permId: permissionId }, type: Sequelize.QueryTypes.DELETE }
    );
  },
};
