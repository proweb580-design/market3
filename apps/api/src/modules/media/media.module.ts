import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { OBJECT_STORAGE, SupabaseObjectStorage } from './object-storage.js';

@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    {
      provide: OBJECT_STORAGE,
      inject: [ENV],
      // Without the service-role key (or project URL) uploads answer 503; the rest of the API is unaffected.
      useFactory: (env: Env) => (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? new SupabaseObjectStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY) : null),
    },
  ],
})
export class MediaModule {}
