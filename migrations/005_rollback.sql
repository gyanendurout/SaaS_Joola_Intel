-- ROLLBACK of 005_influencer_x.sql
-- Drops the 2 new tables and removes the x_handle column.

drop table if exists influencer_x_posts cascade;
drop table if exists influencer_x_snapshots cascade;

alter table influencers drop column if exists x_handle;
