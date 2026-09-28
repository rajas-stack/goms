-- Up Migration

-- A profile picture for a SalesPerson, same "data URL, no separate asset
-- store" convention as employees.photo_url. Nullable: unset means no photo,
-- rendered as initials (Avatar already supports this — see
-- src/components/ui/Avatar.tsx).
ALTER TABLE sales_persons ADD COLUMN photo_url TEXT;

-- Down Migration

ALTER TABLE sales_persons DROP COLUMN photo_url;
