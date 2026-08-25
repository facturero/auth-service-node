/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const NAMESPACE = '00000000-0000-0000-0000-000000000000';

    function uuidFromCode(code) {
      const hash = require('node:crypto').createHash('md5').update(code).digest('hex');
      return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
    }

    const passwordCodes = ['password:view', 'password:change'];

    for (const code of passwordCodes) {
      const [resource, action] = code.split(':');
      await queryInterface.sequelize.query(
        `INSERT INTO permissions (id, code, resource, action, description)
         VALUES (:id, :code, :resource, :action, :description)
         ON DUPLICATE KEY UPDATE code = code`,
        {
          replacements: { id: uuidFromCode(code), code, resource, action, description: null },
          type: Sequelize.QueryTypes.INSERT,
        }
      );
    }

    // Otorgar a los roles de Administrador y Supervisor — tanto plantillas
    // (organization_id NULL) como los clones por organización existentes — para
    // que los orgs ya creadas y los tokens de dispositivo POS hereden el permiso.
    await queryInterface.sequelize.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id
       FROM roles r
       CROSS JOIN permissions p
       WHERE r.name IN ('Administrador', 'Supervisor')
         AND p.code IN ('password:view', 'password:change')
       ON DUPLICATE KEY UPDATE role_id = role_id`,
      { type: Sequelize.QueryTypes.INSERT }
    );
  },

  async down(queryInterface, Sequelize) {
    const passwordCodes = ['password:view', 'password:change'];
    const permIds = passwordCodes.map((code) => {
      const hash = require('node:crypto').createHash('md5').update(code).digest('hex');
      return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
    });

    await queryInterface.sequelize.query(
      `DELETE FROM role_permissions WHERE permission_id IN (:permIds)`,
      { replacements: { permIds }, type: Sequelize.QueryTypes.DELETE }
    );
    await queryInterface.sequelize.query(
      `DELETE FROM permissions WHERE id IN (:permIds)`,
      { replacements: { permIds }, type: Sequelize.QueryTypes.DELETE }
    );
  },
};
