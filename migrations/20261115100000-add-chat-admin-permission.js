'use strict';

const crypto = require('node:crypto');

function uuidFromCode(code) {
  const hash = crypto.createHash('md5').update(code).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
}

/**
 * Permiso de la mensajería al estilo Slack (chat-service). Mismo patrón que 20261111100000-add-project-tag-permission.js.
 *
 *   - `chat:admin` gestionar CUALQUIER canal de la organización (renombrar, tema, archivar, quitar personas), borrar mensajes ajenos
 *                  en canales y usar @canal / @aquí en canales grandes. NO abre mensajes directos ni canales privados de los que no es
 *                  miembro (decisión del dueño, 2026-11-14: «privado, sin exportar»). Administrador.
 *
 * Usar el chat no pide permiso (cualquier miembro activo); el gateway solo exige el módulo `comm.internal_chat`. Lo exige chat-service
 * (`domain/access.ts`, `CHAT_ADMIN`): no es de adorno. Diseño en backend/chat-service/IMPLEMENTATION.md.
 */
const GRANTS = {
  'chat:admin': ['Administrador'],
};

const DESCRIPTIONS = {
  'chat:admin': 'Administrar la mensajería: gestionar cualquier canal y borrar mensajes ajenos en canales (no da acceso a DMs ni canales privados ajenos)',
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
         AND r.name IN ('Administrador')`,
      { replacements: { permIds } }
    );
    await queryInterface.sequelize.query('DELETE FROM permissions WHERE id IN (:permIds)', { replacements: { permIds } });
  },
};
