import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from './modules/users/users.module';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { RolesModule } from './modules/roles/roles.module';
import { BrandsModule } from './modules/brands/brands.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { ShippingProvidersModule } from './modules/shipping_providers/shipping_providers.module';
import { ShippingServicesModule } from './modules/shipping_services/shipping_services.module';
import { UserRolesModule } from './modules/user_roles/user_roles.module';
import { AddressesModule } from './modules/addresses/addresses.module';
import { CartsModule } from './modules/carts/carts.module';
import { ProductsModule } from './modules/products/products.module';
import { ProductVariantsModule } from './modules/product_variants/product_variants.module';
import { ImagesModule } from './modules/images/images.module';
import { ProductCategoriesModule } from './modules/product_categories/product_categories.module';
import { ProductPromotionsModule } from './modules/product_promotions/product_promotions.module';
import { CartItemsModule } from './modules/cart_items/cart_items.module';
import { OrdersModule } from './modules/orders/orders.module';
import { OrderDetailsModule } from './modules/order_details/order_details.module';
import { ShippingModule } from './modules/shipping/shipping.module';
import { TransitionsModule } from './modules/transitions/transitions.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { FrameSpecsModule } from './modules/frame-specs/frame-specs.module';
import { RxLensSpecsModule } from './modules/rx-lens-specs/rx-lens-specs.module';
import { ContactLensSpecsModule } from './modules/contact-lens-specs/contact-lens-specs.module';
import { AuthModule } from './modules/auth/auth.module';
import { MailerModule } from '@nestjs-modules/mailer';
import { FeaturesModule } from './modules/feartures/feartures.module';
import { ContactLensAxisModule } from './modules/contact_lens_axis/contact_lens_axis.module';
import { SupersetModule } from './modules/superset/superset.module';
import { SupportModule } from './modules/support/support.module';


@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST'),
        port: configService.get<number>('DB_PORT'),
        username: configService.get<string>('DB_USERNAME'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_NAME'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: false,
      }),
      inject: [ConfigService],
    }),
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        transport: {
          host: 'smtp.gmail.com',
          port: 587,
          secure: false,
          auth: {
            user: configService.get<string>('MAIL_USER'),
            pass: configService.get<string>('MAIL_PASS'),
          },
        },
        defaults: {
          from: '"True Look Support" <no-reply@truelook.com>',
        },
      }),
      inject: [ConfigService],
    }),
    UsersModule,
    RolesModule,
    BrandsModule,
    CategoriesModule,
    PromotionsModule,
    ShippingProvidersModule,
    ShippingServicesModule,
    UserRolesModule,
    AddressesModule,
    CartsModule,
    ProductsModule,
    ProductVariantsModule,
    ImagesModule,
    ProductCategoriesModule,
    ProductPromotionsModule,
    CartItemsModule,
    OrdersModule,
    OrderDetailsModule,
    ShippingModule,
    TransitionsModule,
    PaymentsModule,
    FrameSpecsModule,
    RxLensSpecsModule,
    ContactLensSpecsModule,
    ContactLensAxisModule,
    AuthModule,
    FeaturesModule,
    SupersetModule,
    SupportModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
