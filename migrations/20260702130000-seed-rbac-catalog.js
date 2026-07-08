/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // ---- Permissions catalog ----
    const permissionCodes = [
      'customer:create', 'customer:read', 'customer:update', 'customer:delete',
      'product:create',  'product:read',  'product:update',  'product:delete',
      'invoice:create',  'invoice:read',  'invoice:void',    'invoice:authorize',
      'organization:read', 'organization:update', 'organization:admin',
      'establishment:create', 'establishment:read', 'establishment:update',
      'user:invite', 'user:read', 'user:update', 'user:assign_role',
      'tax_config:read', 'report:read', 'analytics:read',
    ];

    // Stable UUIDs derived from code (v5 DNS-style namespace)
    const NAMESPACE = '00000000-0000-0000-0000-000000000000';

    function uuidFromCode(code) {
      // Simple deterministic uuid from code using a predictable pattern
      const hash = require('node:crypto').createHash('md5').update(code).digest('hex');
      return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-${((parseInt(hash.slice(16,18),16) & 0x3f) | 0x80).toString(16)}${hash.slice(18,20)}-${hash.slice(20,32)}`;
    }

    const permissions = permissionCodes.map(code => {
      const [resource, action] = code.split(':');
      return {
        id: uuidFromCode(code),
        code,
        resource,
        action,
        description: null,
      };
    });

    for (const perm of permissions) {
      await queryInterface.sequelize.query(
        `INSERT INTO permissions (id, code, resource, action, description)
         VALUES (:id, :code, :resource, :action, :description)
         ON DUPLICATE KEY UPDATE code = code`,
        { replacements: perm, type: Sequelize.QueryTypes.INSERT }
      );
    }

    // ---- Template roles (organization_id = NULL, is_system = true) ----
    const roleIds = {
      administrador: '00000000-0000-4000-a000-000000000001',
      vendedor:      '00000000-0000-4000-a000-000000000002',
      contador:      '00000000-0000-4000-a000-000000000003',
      soloLectura:   '00000000-0000-4000-a000-000000000004',
      supervisor:    '00000000-0000-4000-a000-000000000005',
    };

    const roles = [
      { id: roleIds.administrador, name: 'Administrador', description: 'Acceso total a todas las funcionalidades' },
      { id: roleIds.vendedor,      name: 'Vendedor',      description: 'Gestión de clientes, productos y facturación' },
      { id: roleIds.contador,      name: 'Contador',      description: 'Acceso a facturación, reportes y configuración fiscal' },
      { id: roleIds.soloLectura,   name: 'Solo lectura',  description: 'Acceso de solo lectura a todos los módulos' },
      { id: roleIds.supervisor,    name: 'Supervisor',    description: 'Acceso total excepto configuración de organización' },
    ];

    for (const role of roles) {
      await queryInterface.sequelize.query(
        `INSERT INTO roles (id, organization_id, name, description, is_system, created_at, updated_at)
         VALUES (:id, NULL, :name, :description, true, NOW(), NOW())
         ON DUPLICATE KEY UPDATE name = name`,
        { replacements: role, type: Sequelize.QueryTypes.INSERT }
      );
    }

    // ---- role_permissions ----
    const codesByRole = {
      [roleIds.administrador]: permissionCodes, // todos
      [roleIds.vendedor]: [
        'customer:create', 'customer:read', 'customer:update', 'customer:delete',
        'product:read',
        'invoice:create', 'invoice:read',
      ],
      [roleIds.contador]: [
        'invoice:read', 'report:read', 'tax_config:read',
      ],
      [roleIds.soloLectura]: permissionCodes
        .filter(c => c.endsWith(':read'))
        .concat(['organization:read']),
      [roleIds.supervisor]: permissionCodes
        .filter(c => c !== 'organization:admin' && c !== 'organization:update'),
    };

    for (const [roleId, codes] of Object.entries(codesByRole)) {
      for (const code of codes) {
        const perm = permissions.find(p => p.code === code);
        if (!perm) continue;
        await queryInterface.sequelize.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           VALUES (:roleId, :permId)
           ON DUPLICATE KEY UPDATE role_id = role_id`,
          { replacements: { roleId, permId: perm.id }, type: Sequelize.QueryTypes.INSERT }
        );
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('role_permissions', {});
    await queryInterface.bulkDelete('roles', {});
    await queryInterface.bulkDelete('permissions', {});
  },
};
