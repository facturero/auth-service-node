/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const SUPERVISOR_ID = '00000000-0000-4000-a000-000000000005';

    // Insertar el template del rol Supervisor
    await queryInterface.sequelize.query(
      `INSERT IGNORE INTO roles (id, organization_id, name, description, is_system, created_at, updated_at)
       VALUES (:id, NULL, 'Supervisor', 'Acceso total excepto configuración de organización', true, NOW(), NOW())`,
      { replacements: { id: SUPERVISOR_ID }, type: Sequelize.QueryTypes.INSERT }
    );

    // Obtener todos los códigos de permiso existentes
    const [permissions] = await queryInterface.sequelize.query(
      `SELECT id, code FROM permissions`
    );

    // Filtrar los que NO sean organization:admin ni organization:update
    const allowedCodes = permissions
      .filter((p) => p.code !== 'organization:admin' && p.code !== 'organization:update')
      .map((p) => p.id);

    // Asignar todos al Supervisor
    for (const permId of allowedCodes) {
      await queryInterface.sequelize.query(
        `INSERT IGNORE INTO role_permissions (role_id, permission_id)
         VALUES (:roleId, :permId)`,
        { replacements: { roleId: SUPERVISOR_ID, permId }, type: Sequelize.QueryTypes.INSERT }
      );
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM role_permissions WHERE role_id = '00000000-0000-4000-a000-000000000005'`
    );
    await queryInterface.sequelize.query(
      `DELETE FROM roles WHERE id = '00000000-0000-4000-a000-000000000005'`
    );
  },
};
