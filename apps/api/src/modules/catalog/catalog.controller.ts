import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  collectionInputSchema,
  paginationQuerySchema,
  productInputSchema,
  productListQuerySchema,
  sizeChartInputSchema,
  storefrontContentSchema,
  type CollectionInput,
  type PaginationQuery,
  type ProductInput,
  type SizeChartInput,
  type StorefrontContent,
} from '@repo/shared';
import { z } from 'zod';
import { CurrentTenant, Public, Req, RequirePermissions } from '../../common/decorators.js';
import type { AppRequest, Tenant } from '../../common/principal.js';
import { ApiZodBody, ApiZodQuery, ZodPipe } from '../../common/zod.js';
import { CheckLimit } from '../billing/subscription.guard.js';
import { CatalogService } from './catalog.service.js';
import { StorefrontService } from './storefront.service.js';

const id = new ParseUUIDPipe();

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('organizations/:orgId')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // ── products ──

  @Get('products')
  @RequirePermissions('catalog.read')
  @ApiZodQuery(productListQuerySchema)
  listProducts(@CurrentTenant() t: Tenant, @Query(new ZodPipe(productListQuerySchema)) q: z.infer<typeof productListQuerySchema>) {
    return this.catalog.listProducts(t, q);
  }

  @Post('products')
  @RequirePermissions('catalog.write')
  @CheckLimit('products.max')
  @ApiZodBody(productInputSchema)
  createProduct(@Req() req: AppRequest, @CurrentTenant() t: Tenant, @Body(new ZodPipe(productInputSchema)) body: ProductInput) {
    return this.catalog.saveProduct(req, t, body);
  }

  @Get('products/:id')
  @RequirePermissions('catalog.read')
  getProduct(@CurrentTenant() t: Tenant, @Param('id', id) productId: string) {
    return this.catalog.getProduct(t, productId);
  }

  @Put('products/:id')
  @RequirePermissions('catalog.write')
  @ApiZodBody(productInputSchema)
  updateProduct(@Req() req: AppRequest, @CurrentTenant() t: Tenant, @Param('id', id) productId: string, @Body(new ZodPipe(productInputSchema)) body: ProductInput) {
    return this.catalog.saveProduct(req, t, body, productId);
  }

  @Delete('products/:id')
  @HttpCode(204)
  @RequirePermissions('catalog.write')
  deleteProduct(@Req() req: AppRequest, @CurrentTenant() t: Tenant, @Param('id', id) productId: string) {
    return this.catalog.deleteProduct(req, t, productId);
  }

  // ── collections ──

  @Get('collections')
  @RequirePermissions('catalog.read')
  listCollections(@CurrentTenant() t: Tenant) {
    return this.catalog.listCollections(t);
  }

  @Post('collections')
  @RequirePermissions('catalog.write')
  @ApiZodBody(collectionInputSchema)
  createCollection(@Req() req: AppRequest, @CurrentTenant() t: Tenant, @Body(new ZodPipe(collectionInputSchema)) body: CollectionInput) {
    return this.catalog.saveCollection(req, t, body);
  }

  @Get('collections/:id')
  @RequirePermissions('catalog.read')
  getCollection(@CurrentTenant() t: Tenant, @Param('id', id) collectionId: string) {
    return this.catalog.getCollection(t, collectionId);
  }

  @Put('collections/:id')
  @RequirePermissions('catalog.write')
  @ApiZodBody(collectionInputSchema)
  updateCollection(@Req() req: AppRequest, @CurrentTenant() t: Tenant, @Param('id', id) collectionId: string, @Body(new ZodPipe(collectionInputSchema)) body: CollectionInput) {
    return this.catalog.saveCollection(req, t, body, collectionId);
  }

  @Delete('collections/:id')
  @HttpCode(204)
  @RequirePermissions('catalog.write')
  deleteCollection(@Req() req: AppRequest, @CurrentTenant() t: Tenant, @Param('id', id) collectionId: string) {
    return this.catalog.deleteCollection(req, t, collectionId);
  }

  // ── size charts ──

  @Get('size-charts')
  @RequirePermissions('catalog.read')
  listSizeCharts(@CurrentTenant() t: Tenant) {
    return this.catalog.listSizeCharts(t);
  }

  @Post('size-charts')
  @RequirePermissions('catalog.write')
  @ApiZodBody(sizeChartInputSchema)
  createSizeChart(@Req() req: AppRequest, @CurrentTenant() t: Tenant, @Body(new ZodPipe(sizeChartInputSchema)) body: SizeChartInput) {
    return this.catalog.saveSizeChart(req, t, body);
  }

  @Put('size-charts/:id')
  @RequirePermissions('catalog.write')
  @ApiZodBody(sizeChartInputSchema)
  updateSizeChart(@Req() req: AppRequest, @CurrentTenant() t: Tenant, @Param('id', id) chartId: string, @Body(new ZodPipe(sizeChartInputSchema)) body: SizeChartInput) {
    return this.catalog.saveSizeChart(req, t, body, chartId);
  }

  @Delete('size-charts/:id')
  @HttpCode(204)
  @RequirePermissions('catalog.write')
  deleteSizeChart(@Req() req: AppRequest, @CurrentTenant() t: Tenant, @Param('id', id) chartId: string) {
    return this.catalog.deleteSizeChart(req, t, chartId);
  }

  // ── media & storefront content ──

  @Get('media')
  @RequirePermissions('catalog.read')
  @ApiZodQuery(paginationQuerySchema)
  listMedia(@CurrentTenant() t: Tenant, @Query(new ZodPipe(paginationQuerySchema)) q: PaginationQuery) {
    return this.catalog.listMedia(t, q);
  }

  @Get('storefront')
  @RequirePermissions('catalog.read')
  getContent(@CurrentTenant() t: Tenant) {
    return this.catalog.getContent(t);
  }

  @Put('storefront')
  @RequirePermissions('content.write')
  @ApiZodBody(storefrontContentSchema)
  saveContent(@Req() req: AppRequest, @CurrentTenant() t: Tenant, @Body(new ZodPipe(storefrontContentSchema)) body: StorefrontContent) {
    return this.catalog.saveContent(req, t, body);
  }
}

/** Public storefront reads, consumed (and cached) by the web and Mini App servers. */
@ApiTags('storefront')
@Public()
@Controller('storefront')
export class StorefrontController {
  constructor(private readonly storefront: StorefrontService) {}

  @Get(':store')
  async store(@Param('store') slug: string) {
    return (await this.storefront.store(slug)) ?? notFound();
  }

  @Get(':store/catalog')
  async catalog(@Param('store') slug: string) {
    return (await this.storefront.catalog(slug)) ?? notFound();
  }
}

function notFound(): never {
  throw new NotFoundException('Store not found');
}
