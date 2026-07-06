/**
 * Recorta el read-model de organización en auth a lo mínimo que el servicio
 * necesita para el token: `id` + `country_code`. El nombre y el fundador
 * (`owner_id`) dejan de vivir aquí: los nombres los posee organization-service
 * (razón social / nombre comercial) y el fundador queda registrado como el
 * Administrador de la organización (membership + user_role).
 *
 * IMPORTANTE: correr esta migración es obligatorio tras el cambio de código,
 * porque `owner_id` era NOT NULL y el código ya no lo provee al crear la org.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeColumn('organizations', 'owner_id');
    await queryInterface.removeColumn('organizations', 'name');
  },

  async down(queryInterface, Sequelize) {
    const { STRING, CHAR } = Sequelize;
    await queryInterface.addColumn('organizations', 'name', { type: STRING(255), allowNull: true });
    // Se recrea como nullable para no fallar con filas existentes.
    await queryInterface.addColumn('organizations', 'owner_id', { type: CHAR(36), allowNull: true });
  },
};
