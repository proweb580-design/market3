import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { orderCheckoutSchema, orderTokenQuerySchema, ordersQuerySchema, quoteSchema, type OrderCheckoutInput } from '@repo/shared';
import type { z } from 'zod';
import { CurrentTenant, OptionalAuth, Public, Req, RequirePermissions } from '../../common/decorators.js';
import type { AppRequest, Tenant } from '../../common/principal.js';
import { ApiZodBody, ApiZodQuery, ZodPipe } from '../../common/zod.js';
import { OrdersService } from './orders.service.js';

const id = new ParseUUIDPipe();

/** Buyer side: price a cart, pay for it, look at the order. No account required. */
@ApiTags('checkout')
@Controller('storefront/:store')
export class CheckoutController {
  constructor(private readonly orders: OrdersService) {}

  @Post('quote')
  @HttpCode(200)
  @Public()
  @ApiZodBody(quoteSchema)
  quote(@Param('store') store: string, @Body(new ZodPipe(quoteSchema)) body: z.infer<typeof quoteSchema>) {
    return this.orders.quote(store, body.lines);
  }

  @Post('checkout')
  @OptionalAuth()
  @ApiBearerAuth()
  @ApiZodBody(orderCheckoutSchema)
  checkout(@Req() req: AppRequest, @Param('store') store: string, @Body(new ZodPipe(orderCheckoutSchema)) body: OrderCheckoutInput) {
    return this.orders.checkout(req, store, body);
  }

  @Get('orders/:orderId')
  @OptionalAuth()
  @ApiBearerAuth()
  @ApiZodQuery(orderTokenQuerySchema)
  order(
    @Req() req: AppRequest,
    @Param('store') store: string,
    @Param('orderId', id) orderId: string,
    @Query(new ZodPipe(orderTokenQuerySchema)) q: z.infer<typeof orderTokenQuerySchema>,
  ) {
    return this.orders.getForBuyer(req, store, orderId, q.token);
  }
}

/** Brand side: the orders of one organization. */
@ApiTags('orders')
@ApiBearerAuth()
@Controller('organizations/:orgId/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermissions('orders.read')
  @ApiZodQuery(ordersQuerySchema)
  list(@CurrentTenant() t: Tenant, @Query(new ZodPipe(ordersQuerySchema)) q: z.infer<typeof ordersQuerySchema>) {
    return this.orders.list(t, q);
  }

  @Get(':orderId')
  @RequirePermissions('orders.read')
  get(@CurrentTenant() t: Tenant, @Param('orderId', id) orderId: string) {
    return this.orders.get(t, orderId);
  }

  @Post(':orderId/fulfill')
  @HttpCode(200)
  @RequirePermissions('orders.manage')
  fulfill(@Req() req: AppRequest, @CurrentTenant() t: Tenant, @Param('orderId', id) orderId: string) {
    return this.orders.fulfill(req, t, orderId);
  }

  @Post(':orderId/cancel')
  @HttpCode(200)
  @RequirePermissions('orders.manage')
  cancel(@Req() req: AppRequest, @CurrentTenant() t: Tenant, @Param('orderId', id) orderId: string) {
    return this.orders.cancel(req, t, orderId);
  }
}
