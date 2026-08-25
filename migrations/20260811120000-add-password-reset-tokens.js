'use strict';

/**
 * Tokens de un solo uso para el flujo "restaurar contraseña": el administrador
 * dispara un correo con un link; el empleado establece una nueva contraseña.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('password_reset_tokens', {
      id: { type: Sequelize.CHAR(36), primaryKey: true, allowNull: false },
      user_id: { type: Sequelize.CHAR(36), allowNull: false },
      token_hash: { type: Sequelize.STRING(255), allowNull: false },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      consumed_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('password_reset_tokens', ['token_hash'], {
      unique: true,
      name: 'password_reset_tokens_token_hash_unique',
    });
    await queryInterface.addIndex('password_reset_tokens', ['user_id'], {
      name: 'password_reset_tokens_user_id_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('password_reset_tokens');
  },
};
