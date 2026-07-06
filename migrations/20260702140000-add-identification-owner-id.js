/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { STRING, CHAR } = Sequelize;

    await queryInterface.addColumn('users', 'identification', {
      type: STRING(20),
      allowNull: true,
      unique: true,
    });

    await queryInterface.addColumn('organizations', 'owner_id', {
      type: CHAR(36),
      allowNull: false,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('organizations', 'owner_id');
    await queryInterface.removeColumn('users', 'identification');
  },
};
