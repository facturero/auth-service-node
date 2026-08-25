'use strict';

/**
 * Identidad de terminales POS: credenciales de dispositivo (sin filas en
 * `users`). Cada POS obtiene un access/refresh token ligado a `pos_devices`.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pos_devices', {
      id: { type: Sequelize.CHAR(36), primaryKey: true, allowNull: false },
      emission_point_id: { type: Sequelize.CHAR(36), allowNull: false },
      organization_id: { type: Sequelize.CHAR(36), allowNull: false },
      label: { type: Sequelize.STRING(255), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('pos_devices', ['emission_point_id'], {
      unique: true,
      name: 'pos_devices_emission_point_id_unique',
    });
    await queryInterface.addIndex('pos_devices', ['organization_id'], {
      name: 'pos_devices_organization_id_idx',
    });

    await queryInterface.createTable('device_refresh_tokens', {
      id: { type: Sequelize.CHAR(36), primaryKey: true, allowNull: false },
      pos_device_id: { type: Sequelize.CHAR(36), allowNull: false },
      token_hash: { type: Sequelize.STRING(255), allowNull: false },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      revoked_at: { type: Sequelize.DATE, allowNull: true },
      replaced_by: { type: Sequelize.CHAR(36), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('device_refresh_tokens', ['pos_device_id'], {
      name: 'device_refresh_tokens_pos_device_id_idx',
    });
    await queryInterface.addIndex('device_refresh_tokens', ['token_hash'], {
      unique: true,
      name: 'device_refresh_tokens_token_hash_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('device_refresh_tokens');
    await queryInterface.dropTable('pos_devices');
  },
};
