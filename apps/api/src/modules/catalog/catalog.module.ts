import { Module } from '@nestjs/common';
import { CatalogController, StorefrontController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { StorefrontService } from './storefront.service.js';

@Module({
  controllers: [CatalogController, StorefrontController],
  providers: [CatalogService, StorefrontService],
  exports: [StorefrontService],
})
export class CatalogModule {}
