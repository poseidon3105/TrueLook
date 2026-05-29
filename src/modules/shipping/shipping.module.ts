import { Module } from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { ShippingController } from './shipping.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Shipping } from './entities/shipping.entity';
import { NhanhConfig } from './entities/nhanh-config.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderDetail } from '../order_details/entities/order_detail.entity';
import { ShippingProvidersModule } from '../shipping_providers/shipping_providers.module';
import { ShippingServicesModule } from '../shipping_services/shipping_services.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Shipping, NhanhConfig, Order, OrderDetail]),
    ShippingProvidersModule,
    ShippingServicesModule,
  ],
  controllers: [ShippingController],
  providers: [ShippingService],
})
export class ShippingModule {}
