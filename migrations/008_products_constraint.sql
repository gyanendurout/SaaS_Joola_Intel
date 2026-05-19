-- Fix: products.run_products() upsert was failing with 42P10
-- "no unique constraint" on (name, brand_id).
-- Same pattern as 004_unique_constraints.sql — archive duplicates first.

create table if not exists products_dupe_archive (
  archived_at timestamptz default now(),
  row_data    jsonb
);

insert into products_dupe_archive (row_data)
select to_jsonb(a.*)
from products a
where a.id in (
  select a.id
  from products a
  join products b
    on a.name     = b.name
   and a.brand_id = b.brand_id
   and a.id       < b.id
);

delete from products a
using products b
where a.id < b.id
  and a.name     = b.name
  and a.brand_id = b.brand_id;

alter table products
  add constraint products_name_brand_uniq unique (name, brand_id);
