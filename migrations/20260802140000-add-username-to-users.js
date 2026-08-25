'use strict';

/**
 * Agrega `username` a la tabla `users`: el código de 7 caracteres (letras y
 * números, en mayúsculas) que identifica a cada usuario como cajero/operador
 * en los POS. El código se genera en la entidad de dominio `User` para los
 * usuarios nuevos; aquí se hace el backfill de los existentes con códigos
 * únicos, y queda único a nivel de tabla para que el POS lo use como nombre
 * de usuario de login.
 */
const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomCode() {
  let code = '';
  for (let i = 0; i < 7; i++) {
    code += CHARSET[Math.floor(Math.random() * CHARSET.length)];
  }
  return code;
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'username', {
      type: Sequelize.STRING(7),
      allowNull: true,
    });

    const [users] = await queryInterface.sequelize.query('SELECT id FROM users');
    const used = new Set();
    for (const row of users) {
      let code = randomCode();
      while (used.has(code)) {
        code = randomCode();
      }
      used.add(code);
      await queryInterface.sequelize.query(
        'UPDATE users SET username = :code WHERE id = :id',
        { replacements: { code, id: row.id } },
      );
    }

    await queryInterface.changeColumn('users', 'username', {
      type: Sequelize.STRING(7),
      allowNull: false,
    });
    await queryInterface.addIndex('users', ['username'], {
      unique: true,
      name: 'users_username_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('users', 'users_username_unique');
    await queryInterface.removeColumn('users', 'username');
  },
};
