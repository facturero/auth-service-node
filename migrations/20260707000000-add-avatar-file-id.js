/**
 * Agrega `avatar_file_id` a la tabla `users` para guardar la referencia
 * al archivo de avatar subido. El archivo en sí lo gestiona file-service;
 * auth solo guarda el ID para devolverlo en /auth/me.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'avatar_file_id', {
      type: Sequelize.CHAR(36),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'avatar_file_id');
  },
};
