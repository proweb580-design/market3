-- Vector demo art stored as media rows (demo store); real uploads leave it NULL.
ALTER TABLE "app"."media_files" ADD COLUMN "meta" JSONB;
