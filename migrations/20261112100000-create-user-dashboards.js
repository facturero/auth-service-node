/**
 * Crea `user_dashboards`: la disposición del tablero de Inicio de cada usuario
 * en cada organización (qué widgets tiene, dónde y de qué tamaño).
 *
 * Vive en el servidor, y no en el navegador, para que el usuario vea el mismo
 * tablero en cualquier equipo. La clave es (usuario, organización) porque los
 * widgets dependen de los plugins activos de cada organización: el tablero de
 * una empresa no tiene sentido en otra.
 *
 * `layout` es JSON opaco para auth-service: el catálogo de widgets lo conoce
 * el frontend; aquí solo se valida la forma y los límites al guardar.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('user_dashboards', {
      user_id: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        primaryKey: true,
      },
      organization_id: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        primaryKey: true,
      },
      layout: {
        type: Sequelize.JSON,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_dashboards');
  },
};
