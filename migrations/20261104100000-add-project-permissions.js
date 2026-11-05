'use strict';

const crypto = require('node:crypto');

function uuidFromCode(code) {
  const hash = crypto.createHash('md5').update(code).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
}

/**
 * Permisos de Proyectos y tareas (`projects-service`, módulo `projects.tasks_kanban`, al estilo Asana). Mismo patrón que las
 * migraciones de tesorería y anexos: INSERT sobre permisos, INSERT IGNORE sobre role_permissions por NOMBRE de rol y un solo bump
 * de permissions_version al final.
 *
 * Son pocos A PROPÓSITO, como en Asana: lo que se puede hacer DENTRO de un proyecto (crear, editar, completar, mover tareas) lo
 * decide el rol del usuario en ese proyecto (admin / editor / comentarista / lector), no un permiso global. Un permiso global por
 * cada acción duplicaría esa decisión y daría permisos «de adorno».
 *
 *   - `project:read`   usar el módulo: ver los proyectos de la organización y los privados donde se es miembro, y «Mis tareas».
 *                      Todos los roles, Solo lectura incluido (en un proyecto puede ser comentarista o lector);
 *   - `project:create` crear proyectos (quien lo crea queda como su administrador). Todos menos Solo lectura;
 *   - `project:admin`  ver y administrar TODOS los proyectos de la organización, también los privados de los que no es miembro.
 *                      Solo el Administrador: es la llave para recuperar un proyecto cuyo dueño se fue.
 *
 * Los tres los exige alguna ruta de `projects-service` (y `project:read`, además, el gateway): no hay permisos de adorno.
 */
const GRANTS = {
  'project:read':   ['Administrador', 'Supervisor', 'Contador', 'Vendedor', 'Solo lectura'],
  'project:create': ['Administrador', 'Supervisor', 'Contador', 'Vendedor'],
  'project:admin':  ['Administrador'],
};

const DESCRIPTIONS = {
  'project:read':   'Usar Proyectos y tareas: ver los proyectos de la organización y los privados donde es miembro',
  'project:create': 'Crear proyectos',
  'project:admin':  'Ver y administrar todos los proyectos, incluidos los privados de los que no es miembro',
};

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const touchedRoles = new Set();

    for (const [code, roleNames] of Object.entries(GRANTS)) {
      const [resource, action] = code.split(':');
      const permId = uuidFromCode(code);

      await queryInterface.sequelize.query(
        `INSERT INTO permissions (id, code, resource, action, description)
         VALUES (:id, :code, :resource, :action, :description)
         ON DUPLICATE KEY UPDATE description = VALUES(description)`,
        { replacements: { id: permId, code, resource, action, description: DESCRIPTIONS[code] ?? null }, type: Sequelize.QueryTypes.INSERT }
      );

      await queryInterface.sequelize.query(
        `INSERT IGNORE INTO role_permissions (role_id, permission_id)
         SELECT r.id, :permId
         FROM roles r
         WHERE r.name IN (:roleNames)`,
        { replacements: { permId, roleNames } }
      );

      for (const r of roleNames) touchedRoles.add(r);
    }

    // Quien gana permisos refresca su token una vez: el próximo request responde TOKEN_STALE y el cliente recoge los permisos nuevos.
    await queryInterface.sequelize.query(
      `UPDATE users u
          JOIN user_roles ur ON ur.user_id = u.id
          JOIN roles r ON r.id = ur.role_id
          SET u.permissions_version = u.permissions_version + 1
        WHERE r.name IN (:roleNames)`,
      { replacements: { roleNames: [...touchedRoles] } }
    );
  },

  async down(queryInterface) {
    const permIds = Object.keys(GRANTS).map(uuidFromCode);
    await queryInterface.sequelize.query(
      `DELETE rp FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
       WHERE rp.permission_id IN (:permIds)
         AND r.name IN ('Administrador','Supervisor','Contador','Vendedor','Solo lectura')`,
      { replacements: { permIds } }
    );
    await queryInterface.sequelize.query('DELETE FROM permissions WHERE id IN (:permIds)', { replacements: { permIds } });
  },
};
