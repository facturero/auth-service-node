'use strict';

/**
 * `invoice:authorize` existía en el catálogo desde el seed inicial sin que nada
 * lo exigiera (FACTURACION-BRECHAS.md #33). Desde fiscal-ecuador 2026-09-13 es el
 * permiso para reenviar una factura al SRI (POST /fiscal-invoices/:id/retry),
 * separado de `fiscal:manage`, que además deja subir y revocar el certificado de
 * firma de la empresa.
 *
 * No cambia qué roles lo tienen (Administrador y Supervisor, por el seed): solo
 * le da la descripción que muestra el selector de permisos. El reintento sigue
 * aceptando `fiscal:manage`, así que nadie pierde acceso.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE permissions SET description = :description WHERE code = 'invoice:authorize'`,
      { replacements: { description: 'Reenviar facturas al SRI para su autorización' } },
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE permissions SET description = NULL WHERE code = 'invoice:authorize'`,
    );
  },
};
