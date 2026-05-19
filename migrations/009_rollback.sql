-- Rollback for 009_reddit_comments.sql

drop table if exists reddit_comments cascade;

alter table reddit_mentions
  drop column if exists upvotes_last_scrape,
  drop column if exists velocity_per_hour,
  drop column if exists awards,
  drop column if exists is_removed;
