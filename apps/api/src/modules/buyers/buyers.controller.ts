import { Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { catalogSlug, paginationQuerySchema, type PaginationQuery } from '@repo/shared';
import { CurrentPrincipal, Req, UserOnly } from '../../common/decorators.js';
import type { AppRequest, Principal } from '../../common/principal.js';
import { ApiZodQuery, ZodPipe } from '../../common/zod.js';
import { BuyersService } from './buyers.service.js';

const me = (p: Principal) => (p as { user: { id: string; email: string | null } }).user;
const slug = new ZodPipe(catalogSlug);

@ApiTags('buyer')
@ApiBearerAuth()
@Controller()
export class BuyersController {
  constructor(private readonly buyers: BuyersService) {}

  @Get('users/me/orders')
  @UserOnly()
  @ApiZodQuery(paginationQuerySchema)
  orders(@CurrentPrincipal() p: Principal, @Query(new ZodPipe(paginationQuerySchema)) q: PaginationQuery) {
    return this.buyers.orders(me(p).id, q);
  }

  @Post('users/me/orders/claim')
  @HttpCode(200)
  @UserOnly()
  claim(@Req() req: AppRequest, @CurrentPrincipal() p: Principal) {
    return this.buyers.claimGuestOrders(req, me(p));
  }

  @Get('storefront/:store/wishlist')
  @UserOnly()
  wishlist(@CurrentPrincipal() p: Principal, @Param('store') store: string) {
    return this.buyers.wishlist(me(p).id, store);
  }

  @Put('storefront/:store/wishlist/:product')
  @UserOnly()
  add(@CurrentPrincipal() p: Principal, @Param('store') store: string, @Param('product', slug) product: string) {
    return this.buyers.addToWishlist(me(p).id, store, product);
  }

  @Delete('storefront/:store/wishlist/:product')
  @UserOnly()
  remove(@CurrentPrincipal() p: Principal, @Param('store') store: string, @Param('product', slug) product: string) {
    return this.buyers.removeFromWishlist(me(p).id, store, product);
  }
}
