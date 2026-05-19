-- Rollback for 008_products_constraint.sql
alter table products drop constraint if exists products_name_brand_uniq;
-- (Optional) restore archived dupes:
-- insert into products
-- select * from jsonb_populate_recordset(null::products, jsonb_agg(row_data))
-- from products_dupe_archive;
