import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { confirmUploadSchema, uploadIntentSchema, type UploadIntent } from '@repo/shared';
import type { z } from 'zod';
import { CurrentTenant, Req, RequirePermissions } from '../../common/decorators.js';
import type { AppRequest, Tenant } from '../../common/principal.js';
import { ApiZodBody, ZodPipe } from '../../common/zod.js';
import { MediaService } from './media.service.js';

@ApiTags('media')
@ApiBearerAuth()
@Controller('organizations/:orgId/media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  /** Step 1: agree on what will be uploaded; get a signed upload token for the browser. */
  @Post('upload-url')
  @HttpCode(200)
  @RequirePermissions('catalog.write')
  @ApiZodBody(uploadIntentSchema)
  intent(@CurrentTenant() t: Tenant, @Body(new ZodPipe(uploadIntentSchema)) body: UploadIntent) {
    return this.media.intent(t, body);
  }

  /** Step 2: after the browser uploaded the file, record it. */
  @Post()
  @RequirePermissions('catalog.write')
  @ApiZodBody(confirmUploadSchema)
  confirm(@Req() req: AppRequest, @CurrentTenant() t: Tenant, @Body(new ZodPipe(confirmUploadSchema)) body: z.infer<typeof confirmUploadSchema>) {
    return this.media.confirm(req, t, body.ticket);
  }

  @Delete(':mediaId')
  @HttpCode(204)
  @RequirePermissions('catalog.write')
  remove(@Req() req: AppRequest, @CurrentTenant() t: Tenant, @Param('mediaId', ParseUUIDPipe) mediaId: string) {
    return this.media.remove(req, t, mediaId);
  }
}
