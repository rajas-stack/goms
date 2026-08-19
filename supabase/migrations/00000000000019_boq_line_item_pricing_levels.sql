-- supabase/migrations/00000000000019_boq_line_item_pricing_levels.sql
--
-- 2026-08-19 pricing overhaul spec §2: a BOQ line can have multiple
-- Pricing Level cards (Internal/Floor/Partner/Government/Enterprise/
-- Corporate), each with its own Selling Price; exactly one is "active" and
-- feeds unit_price/discount_pct/line_total. Per-level discount is derived
-- at read time against list_price and is never persisted.

alter table public.commercial_boq_line_items
  add column pricing_levels jsonb not null default '[]'::jsonb,
  add column active_pricing_level text
    check (active_pricing_level is null or active_pricing_level in (
      'internal', 'floor', 'partner', 'government', 'enterprise', 'corporate'
    ));

comment on column public.commercial_boq_line_items.pricing_levels is
  'Array of {level, sellingPrice} the user has explicitly added on this line. sellingPrice is nullable (added but not yet priced). Discount % per level is derived at read time against list_price, never persisted here.';
comment on column public.commercial_boq_line_items.active_pricing_level is
  'Which pricing_levels entry currently drives unit_price/discount_pct/line_total. null means the line falls back to its own stored unit_price/discount_pct exactly as before this column existed.';
