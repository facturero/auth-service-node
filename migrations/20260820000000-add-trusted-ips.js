'use strict';

/**
 * IPs de confianza con rate limit diferenciado.
 * El gateway consulta esta tabla periódicamente y cachea en memoria
 * para decidir el límite de requests por IP.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('trusted_ips', {
      id: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        primaryKey: true,
      },
      ip: {
        type: Sequelize.STRING(45),
        allowNull: false,
        comment: 'IP exacta o CIDR (ej. 192.168.1.100 o 10.0.0.0/8)',
      },
      label: {
        type: Sequelize.STRING(255),
        allowNull: true,
        comment: 'Descripción legible (ej. "Oficina Quito", "DevOPS")',
      },
      enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('trusted_ips', ['ip'], { unique: true });
    await queryInterface.addIndex('trusted_ips', ['enabled']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('trusted_ips');
  },
};
