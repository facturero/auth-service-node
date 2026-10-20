'use strict';

/**
 * Los permisos de contabilidad (Fase 1) y de compras (Fase 2) solo se concedieron a Administrador y Supervisor. Resultado: el rol
 * «Contador» —que existe justamente para llevar la contabilidad— no podía ni abrir el libro diario (403 en todo `/accounting/*`), y
 * «Solo lectura» no podía leer compras ni contabilidad. Se vio al probar con un usuario de cada rol por el gateway.
 *
 *   - Contador: lleva la contabilidad (plan de cuentas, asientos, cierre de periodos), ve las compras y proveedores, registra
 *     facturas de compra y emite retenciones (es quien las hace en la práctica). NO aprueba órdenes ni da excepciones de conciliación
 *     (separación de funciones: eso sigue siendo del Administrador).
 *   - Solo lectura: lee lo nuevo (contabilidad, compras, proveedores), sin tocar nada.
 *
 * Sin filtro de organización, igual que las migraciones anteriores: cubre la plantilla global (las organizaciones NUEVAS la clonan) y
 * los roles ya clonados. Es aditiva e idempotente (INSERT IGNORE): no quita nada a quien ya lo tenía. El `down` solo retira estas
 * concesiones a esos dos roles.
 */
const GRANTS = {
  Contador: [
    'account:read', 'account:manage',
    'journal:read', 'journal:create', 'journal:post', 'journal:reverse',
    'ledger:read', 'period:manage',
    'purchase:read', 'purchase_bill:read', 'purchase_bill:create',
    'supplier:read', 'withholding:issue',
  ],
  'Solo lectura': ['account:read', 'journal:read', 'ledger:read', 'purchase:read', 'purchase_bill:read', 'supplier:read'],
};

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    for (const [roleName, codes] of Object.entries(GRANTS)) {
      await queryInterface.sequelize.query(
        `INSERT IGNORE INTO role_permissions (role_id, permission_id)
         SELECT r.id, p.id
           FROM roles r
           JOIN permissions p ON p.code IN (:codes)
          WHERE r.name = :roleName`,
        { replacements: { roleName, codes } },
      );
    }

    // Quien gana permisos refresca su token una vez: el próximo request responde TOKEN_STALE y el cliente recoge los permisos nuevos.
    await queryInterface.sequelize.query(
      `UPDATE users u
          JOIN user_roles ur ON ur.user_id = u.id
          JOIN roles r ON r.id = ur.role_id
          SET u.permissions_version = u.permissions_version + 1
        WHERE r.name IN (:roleNames)`,
      { replacements: { roleNames: Object.keys(GRANTS) } },
    );
  },

  async down(queryInterface) {
    for (const [roleName, codes] of Object.entries(GRANTS)) {
      await queryInterface.sequelize.query(
        `DELETE rp FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.name = :roleName AND p.code IN (:codes)`,
        { replacements: { roleName, codes } },
      );
    }
  },
};
