/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { CHAR, STRING, BOOLEAN, INTEGER, ENUM, DATE } = Sequelize;

    // 1. users (la persona)
    await queryInterface.createTable('users', {
      id: { type: CHAR(36), primaryKey: true },
      email: { type: STRING(255), allowNull: false, unique: true },
      full_name: { type: STRING(255), allowNull: true },
      status: { type: ENUM('active', 'disabled'), allowNull: false, defaultValue: 'active' },
      is_platform_admin: { type: BOOLEAN, allowNull: false, defaultValue: false },
      permissions_version: { type: INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: DATE, allowNull: false },
      updated_at: { type: DATE, allowNull: false },
    });

    // 2. organizations (read-model mínimo)
    await queryInterface.createTable('organizations', {
      id: { type: CHAR(36), primaryKey: true },
      name: { type: STRING(255), allowNull: true },
      country_code: { type: STRING(2), allowNull: true },
      created_at: { type: DATE, allowNull: false },
      updated_at: { type: DATE, allowNull: false },
    });

    // 3. permissions (catálogo de plataforma)
    await queryInterface.createTable('permissions', {
      id: { type: CHAR(36), primaryKey: true },
      code: { type: STRING(100), allowNull: false, unique: true },
      resource: { type: STRING(50), allowNull: false },
      action: { type: STRING(50), allowNull: false },
      description: { type: STRING(255), allowNull: true },
    });

    // 4. roles (por organización; organization_id NULL = plantilla global)
    await queryInterface.createTable('roles', {
      id: { type: CHAR(36), primaryKey: true },
      organization_id: { type: CHAR(36), allowNull: true },
      name: { type: STRING(100), allowNull: false },
      description: { type: STRING(255), allowNull: true },
      is_system: { type: BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: DATE, allowNull: false },
      updated_at: { type: DATE, allowNull: false },
    });
    await queryInterface.addIndex('roles', ['organization_id', 'name'], { unique: true });

    // 5. role_permissions (N:M)
    await queryInterface.createTable('role_permissions', {
      role_id: { type: CHAR(36), allowNull: false, references: { model: 'roles', key: 'id' }, onDelete: 'CASCADE' },
      permission_id: { type: CHAR(36), allowNull: false, references: { model: 'permissions', key: 'id' }, onDelete: 'CASCADE' },
    });
    await queryInterface.addConstraint('role_permissions', {
      fields: ['role_id', 'permission_id'], type: 'primary key', name: 'pk_role_permissions',
    });

    // 6. user_roles (asignación por organización)
    await queryInterface.createTable('user_roles', {
      id: { type: CHAR(36), primaryKey: true },
      user_id: { type: CHAR(36), allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      organization_id: { type: CHAR(36), allowNull: false },
      role_id: { type: CHAR(36), allowNull: false, references: { model: 'roles', key: 'id' }, onDelete: 'CASCADE' },
      created_at: { type: DATE, allowNull: false },
    });
    await queryInterface.addIndex('user_roles', ['user_id', 'organization_id', 'role_id'], { unique: true });

    // 7. organization_memberships
    await queryInterface.createTable('organization_memberships', {
      id: { type: CHAR(36), primaryKey: true },
      user_id: { type: CHAR(36), allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      organization_id: { type: CHAR(36), allowNull: false },
      status: { type: ENUM('active', 'invited', 'disabled'), allowNull: false, defaultValue: 'active' },
      created_at: { type: DATE, allowNull: false },
      updated_at: { type: DATE, allowNull: false },
    });
    await queryInterface.addIndex('organization_memberships', ['user_id', 'organization_id'], { unique: true });

    // 8. backfill users desde credentials + FK
    await queryInterface.sequelize.query(`
      INSERT INTO users (id, email, status, is_platform_admin, permissions_version, created_at, updated_at)
      SELECT user_id, email, 'active', false, 0, NOW(), NOW() FROM credentials
    `);
    await queryInterface.addConstraint('credentials', {
      fields: ['user_id'], type: 'foreign key', name: 'fk_credentials_user',
      references: { table: 'users', field: 'id' }, onDelete: 'RESTRICT',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeConstraint('credentials', 'fk_credentials_user');
    const tables = ['organization_memberships', 'user_roles', 'role_permissions', 'roles', 'permissions', 'organizations', 'users'];
    for (const t of tables) {
      await queryInterface.dropTable(t);
    }
  },
};
