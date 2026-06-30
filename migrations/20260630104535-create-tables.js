/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. credentials
    await queryInterface.createTable('credentials', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      user_id: { type: Sequelize.CHAR(36), allowNull: false, unique: true },
      email: { type: Sequelize.STRING(255), allowNull: false, unique: true },
      password_hash: { type: Sequelize.STRING(255), allowNull: true },
      email_verified: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      status: { type: Sequelize.ENUM('active', 'disabled'), allowNull: false, defaultValue: 'active' },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    // 2. oauth_accounts
    await queryInterface.createTable('oauth_accounts', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      credential_id: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        references: { model: 'credentials', key: 'id' },
        onDelete: 'CASCADE',
      },
      provider: { type: Sequelize.STRING(20), allowNull: false },
      provider_user_id: { type: Sequelize.STRING(255), allowNull: false },
      email: { type: Sequelize.STRING(255), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('oauth_accounts', ['provider', 'provider_user_id'], { unique: true });

    // 3. refresh_tokens
    await queryInterface.createTable('refresh_tokens', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      credential_id: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        references: { model: 'credentials', key: 'id' },
        onDelete: 'CASCADE',
      },
      token_hash: { type: Sequelize.STRING(255), allowNull: false, unique: true },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      revoked_at: { type: Sequelize.DATE, allowNull: true },
      replaced_by: { type: Sequelize.CHAR(36), allowNull: true },
      user_agent: { type: Sequelize.STRING(255), allowNull: true },
      ip: { type: Sequelize.STRING(45), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('refresh_tokens', ['credential_id']);

    // 4. outbox_messages
    await queryInterface.createTable('outbox_messages', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      aggregate_type: { type: Sequelize.STRING(50), allowNull: false },
      aggregate_id: { type: Sequelize.CHAR(36), allowNull: false },
      type: { type: Sequelize.STRING(100), allowNull: false },
      payload: { type: Sequelize.JSON, allowNull: false },
      occurred_at: { type: Sequelize.DATE, allowNull: false },
      processed_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('outbox_messages', ['processed_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('refresh_tokens');
    await queryInterface.dropTable('oauth_accounts');
    await queryInterface.dropTable('outbox_messages');
    await queryInterface.dropTable('credentials');
  },
};
