import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { JobsController } from './jobs.controller.js';

@Module({ imports: [OrdersModule], controllers: [JobsController] })
export class JobsModule {}
