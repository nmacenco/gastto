-- Generated as a Drizzle custom migration because drizzle-kit 0.22.8 does not diff PostgreSQL CHECK constraints.
ALTER TABLE "column_mappings"
  DROP CONSTRAINT "chk_gastto_field",
  ADD CONSTRAINT "chk_gastto_field"
    CHECK ("gastto_field" IN ('monto','moneda','categoria','fecha','concepto','medio_pago','subcategoria'));
