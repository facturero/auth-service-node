'use strict';

/**
 * Asignación usuario ↔ establecimiento (M:N). Un empleado (user) puede
 * operar en uno o más establecimientos de la organización; el POS solo baja
 * los usuarios asignados al establecimiento del punto de emisión emparejado.
 * Los establecimientos viven en organization-service (organization_db); aquí
 * solo se referencia el uuid.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('user_establishments', {
      user_id: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      establishment_id: {
        type: Sequelize.CHAR(36),
        allowNull: false,
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('user_establishments', ['user_id', 'establishment_id'], { unique: true });
    await queryInterface.addIndex('user_establishments', ['establishment_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_establishments');
  },
};
