ALTER TABLE "app"."orders" ADD COLUMN "access_token_hash" TEXT;
CREATE UNIQUE INDEX "orders_access_token_hash_key" ON "app"."orders"("access_token_hash");
