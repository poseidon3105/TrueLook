import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { PayOS } from '@payos/node';

import { Payment } from './entities/payment.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderDetail } from '../order_details/entities/order_detail.entity';
import { ProductVariant } from '../product_variants/entities/product_variant.entity';
import { Cart } from '../carts/entities/cart.entity';
import { CartItem } from '../cart_items/entities/cart_item.entity';
import { Transition } from '../transitions/entities/transition.entity';
import { Promotion } from '../promotions/entities/promotion.entity';
import { OrdersService } from '../orders/orders.service';

@Injectable()
export class PaymentsService {

  private readonly logger = new Logger(PaymentsService.name);
  private payOS: PayOS;

  constructor(

    private dataSource: DataSource,

    @InjectRepository(Payment)
    private paymentRepo: Repository<Payment>,

    @InjectRepository(Order)
    private orderRepo: Repository<Order>,

    @InjectRepository(OrderDetail)
    private orderDetailRepo: Repository<OrderDetail>,

    @InjectRepository(ProductVariant)
    private variantRepo: Repository<ProductVariant>,

    @InjectRepository(Cart)
    private cartRepo: Repository<Cart>,

    @InjectRepository(CartItem)
    private cartItemRepo: Repository<CartItem>,

    @InjectRepository(Transition)
    private transitionRepo: Repository<Transition>,

    @InjectRepository(Promotion)
    private promotionRepo: Repository<Promotion>,

    private ordersService: OrdersService,

  ) {

    this.payOS = new PayOS({
      clientId: process.env.PAYOS_CLIENT_ID!,
      apiKey: process.env.PAYOS_API_KEY!,
      checksumKey: process.env.PAYOS_CHECKSUM_KEY!,
    });

  }


  private async validatePromotion(order: Order, promotion: Promotion) {

    const now = new Date();

    if (promotion.status !== "Active") {
      throw new Error("Promotion not active");
    }

    if (now < promotion.start_time || now > promotion.end_time) {
      throw new Error("Promotion expired");
    }

    const minOrder = Number(promotion.condition || 0);
    const orderTotal = Number(order.total);

    if (orderTotal < minOrder) {
      throw new Error(`Order must be >= ${minOrder}`);
    }

    return true;
  }


  private calculateDiscount(orderTotal: number, promotion: Promotion): number {

    let discount = Number(promotion.discount);

    if (discount > orderTotal) {
      discount = orderTotal;
    }

    return discount;
  }


  async createPayment(orderId: string, promotionId?: string) {

    const order = await this.orderRepo.findOne({
      where: { id: orderId }
    });

    if (!order) {
      throw new NotFoundException("Order not found");
    }


    const existingPayment = await this.paymentRepo.findOne({
      where: {
        order_id: orderId,
        status: "Pending"
      }
    });

    if (existingPayment) {
      throw new Error("Payment already exists for this order");
    }

    const totalAmount = Number(order.total);

    if (isNaN(totalAmount) || totalAmount <= 0) {
      throw new Error("Invalid order amount");
    }

    let discount = 0;


    if (promotionId) {

      const promotion = await this.promotionRepo.findOne({
        where: { id: promotionId }
      });

      if (promotion) {

        await this.validatePromotion(order, promotion);

        discount = this.calculateDiscount(totalAmount, promotion);

      }

    }


    const finalAmount = totalAmount - discount;

    if (finalAmount < 0) {
      throw new Error("Invalid final amount");
    }


    order.total = finalAmount;
    await this.orderRepo.save(order);


    if (finalAmount === 0) {

      await this.ordersService.confirmOrder(orderId);

      return {
        message: "Order paid by promotion",
        total: totalAmount,
        discount: discount,
        finalAmount: 0
      };

    }


    const orderCode = Date.now() + Math.floor(Math.random() * 1000);


    const payment = this.paymentRepo.create({
      id: orderCode.toString(),
      order_id: orderId,
      amount: finalAmount,
      method: "Bank Transfer",
      status: "Pending"
    });

    await this.paymentRepo.save(payment);


    const body = {
      orderCode: orderCode,
      amount: finalAmount,
      description: `Order ${orderId}`,
      items: [
        {
          name: "Order payment",
          quantity: 1,
          price: finalAmount,
        }
      ],
      cancelUrl: process.env.PAYOS_CANCEL_URL!,
      returnUrl: process.env.PAYOS_RETURN_URL!,
    };

    this.logger.log(`Creating PayOS payment for order ${orderId}`);

    const paymentLink = await this.payOS.paymentRequests.create(body);

    return {
      checkoutUrl: paymentLink.checkoutUrl,
      qrCode: paymentLink.qrCode,
      total: totalAmount,
      discount: discount,
      finalAmount: finalAmount
    };

  }


  async handleWebhook(body: any) {
    const data =
      await this.payOS.webhooks.verify(body);

    if (data.code !== '00') {
      this.logger.warn(
        'Payment not successful',
      );
      return;
    }

    const paymentId =
      data.orderCode.toString();

    await this.dataSource.transaction(
      async (manager) => {

        const payment =
          await manager.findOne(
            Payment,
            {
              where: {
                id: paymentId,
              },
            },
          );

        if (!payment) {
          throw new Error(
            'Payment not found',
          );
        }

        if (
          payment.status ===
          'Completed'
        ) {
          this.logger.log(
            'Payment already processed',
          );
          return;
        }

        const order =
          await manager.findOne(
            Order,
            {
              where: {
                id: payment.order_id,
              },
            },
          );

        if (!order) {
          throw new Error(
            'Order not found',
          );
        }

        const orderDetails =
          await manager.find(
            OrderDetail,
            {
              where: {
                order_id:
                  payment.order_id,
              },
            },
          );

        if (
          orderDetails.length === 0
        ) {
          throw new Error(
            'Order has no items',
          );
        }

        // Trừ kho
        for (const item of orderDetails) {

          const variant =
            await manager.findOne(
              ProductVariant,
              {
                where: {
                  id: item.variant_id,
                },
              },
            );

          if (!variant) {
            throw new Error(
              `Variant ${item.variant_id} not found`,
            );
          }

          if (
            variant.quantity <
            item.quantity
          ) {
            throw new Error(
              `Product ${variant.name} not enough stock`,
            );
          }

          variant.quantity -=
            item.quantity;

          await manager.save(
            variant,
          );
        }

        // Payment
        payment.status = 'Completed';
        payment.payment_date = new Date();

        await manager.save(payment);

        // Update order status
        order.status = 'Confirmed';

        await manager.save(order);

        // Transition
        const transition =
          manager.create(
            Transition,
            {
              id: Date.now().toString(),
              payment_id:
                payment.id,
              transition_payment:
                data.reference,
              create_at:
                new Date(),
              update_time:
                new Date(),
            },
          );

        await manager.save(
          transition,
        );

        // Confirm order
        await this.ordersService.confirmOrder(
          payment.order_id,
          manager,
        );

        this.logger.log(
          `Payment success ${payment.id}`,
        );
      },
    );
  }

}