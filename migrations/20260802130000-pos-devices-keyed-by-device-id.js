'use strict';

/**
 * Los `pos_devices` pasan a identificarse por el `id` = deviceId del terminal
 * (el UUID estable que el POS genera en el primer arranque y que viaja en el
 * body de /pair). Por eso:
 *   - El índice único por emission_point_id se elimina: un punto que quedó
 *     desvinculado puede re-emparejarse con otro dispositivo sin chocar con
 *     la fila antigua (que se conserva pero queda huérfana/inactiva).
 * La PK (id) ya es la columna correcta; no se altera la tabla, solo el índice.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeIndex('pos_devices', 'pos_devices_emission_point_id_unique');
  },

  async down(queryInterface) {
    await queryInterface.addIndex('pos_devices', ['emission_point_id'], {
      unique: true,
      name: 'pos_devices_emission_point_id_unique',
    });
  },
};
