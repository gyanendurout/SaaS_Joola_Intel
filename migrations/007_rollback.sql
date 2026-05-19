-- ROLLBACK of 007_cross_channel_facts.sql
-- Drops the 4 new tables. Safe: no other code depends on them yet.

drop table if exists competitor_switch_events cascade;
drop table if exists topic_lifecycle cascade;
drop table if exists mention_facts cascade;
drop table if exists products_catalog cascade;
