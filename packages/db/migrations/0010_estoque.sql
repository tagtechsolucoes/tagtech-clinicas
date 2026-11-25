-- Estoque e fornecedores: materiais com lote e validade, baixa automática pela agenda,
-- entradas de compra (que viram conta a pagar), pedidos e contagem.

CREATE TABLE suppliers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  contact         text NOT NULL DEFAULT '' CHECK (length(contact) <= 120),
  whatsapp        text NOT NULL DEFAULT '' CHECK (whatsapp ~ '^[0-9]{0,13}$'),
  email           text NOT NULL DEFAULT '' CHECK (length(email) <= 254),
  -- Prazo de entrega em dias úteis e observação ("pedido até 14h").
  lead_time_days  smallint NOT NULL DEFAULT 2 CHECK (lead_time_days BETWEEN 0 AND 90),
  notes           text NOT NULL DEFAULT '' CHECK (length(notes) <= 500),
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE stock_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name                text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  category            text NOT NULL DEFAULT '' CHECK (length(category) <= 60),
  -- Unidade de uso (o que sai na consulta) e de compra (o que vem do fornecedor).
  unit                text NOT NULL DEFAULT 'unidade' CHECK (length(unit) BETWEEN 1 AND 20),
  purchase_unit       text NOT NULL DEFAULT 'unidade' CHECK (length(purchase_unit) BETWEEN 1 AND 20),
  units_per_purchase  numeric(12, 3) NOT NULL DEFAULT 1 CHECK (units_per_purchase > 0),
  -- Custo por unidade de uso (atualizado a cada compra).
  cost_cents          integer NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  min_qty             numeric(12, 3) NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
  supplier_id         uuid,
  -- Validade depois de aberto (frascos de toxina, anestésico), em dias.
  open_validity_days  smallint CHECK (open_validity_days BETWEEN 1 AND 365),
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers (tenant_id, id) ON DELETE SET NULL (supplier_id),
  UNIQUE (tenant_id, id)
);

-- Último preço pago a cada fornecedor (e o anterior, para avisar quando sobe).
CREATE TABLE supplier_prices (
  tenant_id            uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  supplier_id          uuid NOT NULL,
  item_id              uuid NOT NULL,
  last_price_cents     integer NOT NULL CHECK (last_price_cents >= 0),
  previous_price_cents integer CHECK (previous_price_cents >= 0),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (supplier_id, item_id),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, item_id) REFERENCES stock_items (tenant_id, id) ON DELETE CASCADE
);

-- Ficha de materiais do procedimento: o que cada serviço consome.
CREATE TABLE service_materials (
  tenant_id  uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  service_id uuid NOT NULL,
  item_id    uuid NOT NULL,
  qty        numeric(12, 3) NOT NULL CHECK (qty > 0),
  PRIMARY KEY (service_id, item_id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES services (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, item_id) REFERENCES stock_items (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE stock_purchases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  supplier_id  uuid,
  invoice      text NOT NULL DEFAULT '' CHECK (length(invoice) <= 60),
  total_cents  integer NOT NULL CHECK (total_cents >= 0),
  received_on  date NOT NULL,
  expense_id   uuid REFERENCES expenses (id) ON DELETE SET NULL,
  created_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers (tenant_id, id) ON DELETE SET NULL (supplier_id),
  UNIQUE (tenant_id, id)
);

CREATE TABLE stock_lots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  item_id      uuid NOT NULL,
  lot          text NOT NULL DEFAULT '' CHECK (length(lot) <= 60),
  expires_on   date,
  qty          numeric(12, 3) NOT NULL CHECK (qty >= 0),
  cost_cents   integer NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  -- Quando o frasco foi aberto (conta a validade depois de aberto).
  opened_at    timestamptz,
  purchase_id  uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, item_id) REFERENCES stock_items (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, purchase_id) REFERENCES stock_purchases (tenant_id, id) ON DELETE SET NULL (purchase_id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX stock_lots_fefo ON stock_lots (item_id, expires_on NULLS LAST, created_at) WHERE qty > 0;

CREATE TYPE stock_move_kind AS ENUM ('purchase', 'consume', 'return', 'loss', 'expired', 'manual', 'adjust');

CREATE TABLE stock_moves (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  item_id        uuid NOT NULL,
  lot_id         uuid,
  kind           stock_move_kind NOT NULL,
  -- Positivo entra, negativo sai. Sempre na unidade de uso.
  qty            numeric(12, 3) NOT NULL CHECK (qty <> 0),
  cost_cents     integer NOT NULL DEFAULT 0,
  reason         text NOT NULL DEFAULT '' CHECK (length(reason) <= 200),
  appointment_id uuid,
  purchase_id    uuid,
  user_id        uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, item_id) REFERENCES stock_items (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, lot_id) REFERENCES stock_lots (tenant_id, id) ON DELETE SET NULL (lot_id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments (tenant_id, id) ON DELETE SET NULL (appointment_id),
  FOREIGN KEY (tenant_id, purchase_id) REFERENCES stock_purchases (tenant_id, id) ON DELETE SET NULL (purchase_id),
  -- Saída manual exige motivo.
  CHECK (kind NOT IN ('loss', 'expired', 'manual', 'adjust') OR length(reason) >= 3)
);
CREATE INDEX stock_moves_by_item ON stock_moves (item_id, created_at DESC);
CREATE INDEX stock_moves_by_appointment ON stock_moves (appointment_id) WHERE appointment_id IS NOT NULL;

-- Pedido feito ao fornecedor e ainda não recebido (para não pedir duas vezes).
CREATE TABLE purchase_orders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  supplier_id uuid,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'received', 'cancelled')),
  -- [{ itemId, purchaseQty }]
  items       jsonb NOT NULL DEFAULT '[]',
  created_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers (tenant_id, id) ON DELETE SET NULL (supplier_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['suppliers', 'stock_items', 'supplier_prices', 'service_materials',
    'stock_purchases', 'stock_lots', 'stock_moves', 'purchase_orders'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON suppliers, stock_items, stock_purchases, stock_lots, purchase_orders TO tagtech_app;
GRANT SELECT, INSERT ON stock_moves TO tagtech_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON supplier_prices, service_materials TO tagtech_app;
