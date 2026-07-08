module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('organizations', 'owner_id', {
      type: Sequelize.CHAR(36),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('organizations', 'owner_id');
  },
};
