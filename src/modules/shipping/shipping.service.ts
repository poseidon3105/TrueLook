import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';

import { Shipping } from './entities/shipping.entity';
import { NhanhConfig } from './entities/nhanh-config.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderDetail } from '../order_details/entities/order_detail.entity';
import { CartItem } from '../cart_items/entities/cart_item.entity';
import { CreateShippingDto } from './dto/create-shipping.dto';
import { UpdateShippingDto } from './dto/update-shipping.dto';
import { ShippingProvidersService } from '../shipping_providers/shipping_providers.service';
import { ShippingServicesService } from '../shipping_services/shipping_services.service';

@Injectable()
export class ShippingService {
  // in-memory cache for Ahamove token to avoid requesting too often
  private ahamoveTokenCache: { token: string; expiresAt: number } | null = null;
  constructor(
    @InjectRepository(Shipping)
    private shippingRepo: Repository<Shipping>,

    @InjectRepository(NhanhConfig)
    private nhanhRepo: Repository<NhanhConfig>,

    private providersService: ShippingProvidersService,
    private servicesService: ShippingServicesService,
    @InjectRepository(Order)
    private orderRepo: Repository<Order>,

    @InjectRepository(OrderDetail)
    private orderDetailRepo: Repository<OrderDetail>,

    @InjectRepository(CartItem)
    private cartItemRepo: Repository<CartItem>,
  ) { }

  /*
  =============================
  CRUD SHIPPING NỘI BỘ
  =============================
  */



  /*
  =====================================================
  AHAMOVE INTEGRATION (simple wrappers using env vars)
  =====================================================
  */
  private async getOrderItems(orderId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
    });

    if (!order) {
      throw new BadRequestException(
        `Order ${orderId} không tồn tại`,
      );
    }

    const orderDetails =
      await this.orderDetailRepo.find({
        where: {
          order_id: orderId,
        },
      });

    if (!orderDetails.length) {
      throw new BadRequestException(
        'Order chưa có sản phẩm',
      );
    }

    return {
      order,
      orderDetails,
    };
  }

  private buildAhamoveItems(
    orderDetails: OrderDetail[],
  ) {
    return orderDetails.map((item) => ({
      name: `Variant ${item.variant_id}`,
      num: item.quantity,
      price: Number(item.price),
    }));
  }

  async getAhamoveToken() {
    try {
      return await this.fetchAhamoveTokenWithFallback();
    } catch (error: any) {
      console.log('===== AHAMOVE TOKEN ERROR =====');
      console.log(error.response?.data || error.message);
      throw error;
    }
  }

  // Try token endpoints with sensible fallbacks and return parsed response
  private async fetchAhamoveTokenWithFallback() {
    const apiKey = process.env.AHAMOVE_API_KEY || process.env.AHAMOVE_API;
    const mobile = process.env.AHAMOVE_PHONE;

    const attempts = ['/accounts/token', '/v3/accounts/token'];

    for (const p of attempts) {
      try {
        const url = this.ahamoveUrl(p);
        console.log('[Ahamove] requesting token from', url);
        const response = await axios.post(url, { mobile, api_key: apiKey }, { headers: { 'Content-Type': 'application/json' } });
        // normalize response
        if (response?.data) return response.data;
      } catch (err: any) {
        console.log('[Ahamove] token attempt failed for', p, err.response?.data || err.message);
      }
    }

    throw new Error('AHAMOVE token endpoints all failed');
  }

  private ahamoveBase(): string {
    // read raw env, strip accidental repeated key or trailing slashes
    let raw = process.env.AHAMOVE_BASE_URL || '';
    // if someone accidentally put 'AHAMOVE_BASE_URL=...' in the value, strip it
    raw = raw.replace(/^AHAMOVE_BASE_URL=/i, '');
    // remove trailing slashes
    raw = raw.replace(/\/+$/g, '');
    return raw;
  }

  private ahamoveUrl(path: string): string {
    const base = this.ahamoveBase();
    if (!base) throw new Error('AHAMOVE_BASE_URL is not configured');
    if (!path) return base;
    return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  }

  private normalizeAhamovePayload(payload: any, action: 'estimate' | 'create-order') {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new BadRequestException('Payload Ahamove phải là object JSON');
    }

    const normalized: any = { ...payload };

    if (normalized.order_time == null) {
      normalized.order_time = 0;
    }

    if (!Array.isArray(normalized.path) || normalized.path.length < 2) {
      throw new BadRequestException('Payload Ahamove cần trường path là mảng có ít nhất 2 điểm');
    }

    normalized.path = normalized.path.map((item: any, index: number) => {
      if (!item || typeof item !== 'object') {
        throw new BadRequestException(`path[${index}] phải là object`);
      }
      if (item.type && !['PICKUP', 'DELIVERY'].includes(item.type)) {
        throw new BadRequestException(`path[${index}].type phải là PICKUP hoặc DELIVERY nếu có`);
      }
      if (!item.address) {
        throw new BadRequestException(`path[${index}].address không được để trống`);
      }
      if (!item.name) {
        throw new BadRequestException(`path[${index}].name không được để trống`);
      }
      if (!item.mobile) {
        throw new BadRequestException(`path[${index}].mobile không được để trống`);
      }
      return { ...item };
    });

    if (!normalized.service_id && !normalized.group_service_id) {
      throw new BadRequestException('Payload Ahamove cần service_id hoặc group_service_id');
    }
    if (normalized.group_service_id && typeof normalized.group_service_id !== 'string') {
      throw new BadRequestException('group_service_id phải là chuỗi');
    }
    if (normalized.service_id && typeof normalized.service_id !== 'string' && typeof normalized.service_id !== 'number') {
      throw new BadRequestException('service_id phải là chuỗi hoặc số');
    }

    if (normalized.requests != null) {
      if (!Array.isArray(normalized.requests)) {
        throw new BadRequestException('requests phải là mảng');
      }
      normalized.requests = normalized.requests.map((item: any, index: number) => {
        if (!item || typeof item !== 'object') {
          throw new BadRequestException(`requests[${index}] phải là object`);
        }
        if (!item._id) {
          throw new BadRequestException(`requests[${index}]._id không được để trống`);
        }
        return { ...item };
      });
    }

    if (normalized.group_requests != null) {
      if (!Array.isArray(normalized.group_requests)) {
        throw new BadRequestException('group_requests phải là mảng');
      }
      normalized.group_requests = normalized.group_requests.map((item: any, index: number) => {
        if (!item || typeof item !== 'object') {
          throw new BadRequestException(`group_requests[${index}] phải là object`);
        }
        if (!item._id) {
          throw new BadRequestException(`group_requests[${index}]._id không được để trống`);
        }
        if (item.num != null && (typeof item.num !== 'number' || item.num <= 0)) {
          throw new BadRequestException(`group_requests[${index}].num phải là số lớn hơn 0`);
        }
        if (item.tier_code != null && typeof item.tier_code !== 'string') {
          throw new BadRequestException(`group_requests[${index}].tier_code phải là chuỗi`);
        }
        return { ...item };
      });
    }

    if (action === 'create-order') {
      if (!normalized.items || !Array.isArray(normalized.items) || normalized.items.length === 0) {
        throw new BadRequestException('Payload tạo đơn Ahamove cần trường items');
      }
      normalized.items = normalized.items.map((item: any, index: number) => {
        if (!item || typeof item !== 'object') {
          throw new BadRequestException(`items[${index}] phải là object`);
        }
        if (!item.name) {
          throw new BadRequestException(`items[${index}].name không được để trống`);
        }
        const quantity = item.num ?? item.quantity;
        if (quantity == null || typeof quantity !== 'number' || quantity <= 0) {
          throw new BadRequestException(`items[${index}].num (hoặc quantity) phải là số lớn hơn 0`);
        }
        if (item.price == null || typeof item.price !== 'number' || item.price < 0) {
          throw new BadRequestException(`items[${index}].price phải là số không âm`);
        }
        return { ...item };
      });
    }

    if (normalized.package_detail != null) {
      if (Array.isArray(normalized.package_detail)) {
        normalized.package_detail = normalized.package_detail.map((item: any, index: number) => {
          if (!item || typeof item !== 'object') {
            throw new BadRequestException(`package_detail[${index}] phải là object`);
          }
          if (item.weight == null || typeof item.weight !== 'number' || item.weight <= 0) {
            throw new BadRequestException(`package_detail[${index}].weight phải là số lớn hơn 0`);
          }
          return { ...item };
        });
      } else if (typeof normalized.package_detail === 'object') {
        const weight = normalized.package_detail.weight;
        if (weight == null || typeof weight !== 'number' || weight <= 0) {
          throw new BadRequestException('package_detail.weight phải là số lớn hơn 0');
        }
      } else {
        throw new BadRequestException('package_detail phải là object hoặc mảng object');
      }
    }

    if (!normalized.payment_method) {
      normalized.payment_method = 'CASH';
    }

    return normalized;
  }

  private mapAhamoveError(error: any) {
    if (error.response?.data) {
      const data = error.response.data;
      const message =
        data.description || data.message || data.error || data.title || JSON.stringify(data);
      return new BadRequestException(`Ahamove lỗi: ${message}`);
    }
    return error;
  }

  private async getAhamoveAuthHeaders() {
    // try to use cached token first
    if (this.ahamoveTokenCache && Date.now() < this.ahamoveTokenCache.expiresAt) {
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.ahamoveTokenCache.token}`,
      };
    }

    const tokenResponse = await this.getAhamoveToken();
    const token =
      tokenResponse?.token || tokenResponse?.access_token || tokenResponse?.data?.token || tokenResponse?.data?.access_token || tokenResponse?.accessToken;

    if (!token) {
      throw new Error('Không lấy được token Ahamove để gọi API');
    }

    // cache token if possible
    let expiresAt = Date.now() + 60 * 60 * 1000; // default 1 hour
    const expiresIn = tokenResponse?.expires_in || tokenResponse?.data?.expires_in || tokenResponse?.expiredAt || tokenResponse?.data?.expiredAt;
    if (typeof expiresIn === 'number') {
      expiresAt = Date.now() + expiresIn * 1000;
    }

    this.ahamoveTokenCache = { token, expiresAt };

    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }

  async createAhamoveOrder(payload: any) {
    try {
      const normalizedPayload = this.normalizeAhamovePayload(payload, 'create-order');
      const headers = await this.getAhamoveAuthHeaders();
      const url = this.ahamoveUrl('/v3/orders');
      console.log('[Ahamove] create-order url=', url, 'payload=', JSON.stringify(normalizedPayload));
      const response = await axios.post(url, normalizedPayload, { headers });

      const data = response.data;
      // Normalize common shapes
      const orderId = data?.order_id || data?.id || data?.data?.order_id || data?.data?.id || data?.order?.id;
      const price = data?.price || data?.total_price || data?.data?.price || data?.data?.total_price || data?.order?.price;
      const shared_link = data?.shared_link || data?.data?.shared_link || data?.order?.shared_link;

      return { raw: data, order_id: orderId, price, shared_link };
    } catch (error: any) {
      console.log('===== AHAMOVE CREATE ORDER ERROR =====');
      console.log(error.response?.data || error.message);
      throw this.mapAhamoveError(error);
    }
  }

  async getAhamoveOrders() {
    try {

      const shippings =
        await this.shippingRepo.find({
          order: {
            create_at: 'DESC',
          },
        });

      return {
        success: true,
        total: shippings.length,
        data: shippings,
      };

    } catch (error: any) {

      console.log(
        '===== GET SHIPPING LIST ERROR =====',
      );

      console.log(
        error.message,
      );

      throw error;
    }
  }
  async updateAhamoveOrder(payload: any) {
    try {
      if (!payload?.order_id) {
        throw new BadRequestException('Thiếu order_id');
      }

      const body: any = {
        order_id: payload.order_id,
      };

      // optional fields
      if (payload.payment_method) {
        body.payment_method = payload.payment_method;
      }

      if (payload.remarks) {
        body.remarks = payload.remarks;
      }

      if (payload.path) {
        body.path = payload.path;
      }

      if (payload.items) {
        body.items = payload.items;
      }

      const headers = await this.getAhamoveAuthHeaders();

      const url = this.ahamoveUrl('/v3/orders/update');

      console.log(
        '[Ahamove] update-order url=',
        url,
        'payload=',
        JSON.stringify(body),
      );

      const response = await axios.post(url, body, {
        headers,
      });

      return response.data;
    } catch (error: any) {
      console.log('===== AHAMOVE UPDATE ORDER ERROR =====');
      console.log(error.response?.data || error.message);

      throw this.mapAhamoveError(error);
    }
  }

  async cancelAhamoveOrder(payload: {
    order_id: string;
    comment?: string;
  }) {
    try {
      if (!payload?.order_id) {
        throw new BadRequestException(
          'Thiếu order_id',
        );
      }

      const headers =
        await this.getAhamoveAuthHeaders();

      const url =
        this.ahamoveUrl(
          `/v3/orders/${payload.order_id}`,
        );

      const body = {
        comment:
          payload.comment ||
          'Khách hàng muốn hủy đơn',
      };

      console.log(
        '[Ahamove] cancel-order url=',
        url,
      );

      console.log(
        '[Ahamove] cancel-order payload=',
        JSON.stringify(body),
      );

      const response = await axios.delete(
        url,
        {
          headers,
          data: body,
        },
      );

      // update local db
      const shippingRecord =
        await this.shippingRepo.findOne({
          where: {
            nhanh_id: String(payload.order_id),
          },
        });

      if (shippingRecord) {
        shippingRecord.status =
          'Canceled';

        shippingRecord.update_at =
          new Date();

        await this.shippingRepo.save(
          shippingRecord,
        );
      }

      return {
        success: true,
        data: response.data,
      };

    } catch (error: any) {

      console.log(
        '===== AHAMOVE CANCEL ORDER ERROR =====',
      );

      console.log(
        error.response?.data ||
        error.message,
      );

      throw this.mapAhamoveError(
        error,
      );
    }
  }

  async handleAhamoveWebhook(
    payload: any,
  ) {
    console.log(
      'Webhook order:',
      payload._id,
    );

    const shipping =
      await this.shippingRepo.findOne({
        where: {
          nhanh_id: payload._id,
        },
      });

    console.log(
      'Shipping found:',
      shipping,
    );

    if (!shipping) {
      console.log(
        'Không tìm thấy shipping',
      );
      return {
        success: false,
      };
    }

    shipping.status =
      payload.status;

    await this.shippingRepo.save(
      shipping,
    );

    console.log(
      'Shipping updated:',
      payload.status,
    );

    if (
      payload.status ===
      'COMPLETED'
    ) {
      await this.orderRepo.update(
        {
          id: shipping.order_id,
        },
        {
          status: 'DELIVERED',
        },
      );
    }

    if (
      payload.status ===
      'CANCELLED'
    ) {
      await this.orderRepo.update(
        {
          id: shipping.order_id,
        },
        {
          status:
            'SHIPPING_FAILED',
        },
      );
    }

    return {
      success: true,
    };
  }

  async processAhamoveCheckout(
    orderId: string,
    providerId: string,
    serviceId: string,
    extraPayload: any,
  ) {
    console.log('==============================');
    console.log('[AHAMOVE CHECKOUT] START');
    console.log('orderId:', orderId);
    console.log('providerId:', providerId);
    console.log('serviceId:', serviceId);
    console.log('extraPayload:', extraPayload);
    console.log('==============================');

    const PICK_ADDRESS =
      'Tòa Bs16, 88 Phước Thiện, Khu phố 29, Long Bình, Hồ Chí Minh 71300, Việt Nam';

    const PICK_MOBILE = '0822030768';

    try {
      /*
      =====================================
      0. GET ORDER
      =====================================
      */
      console.log('[STEP 0] Fetch order...');

      const order = await this.orderRepo.findOne({
        where: { id: orderId },
        relations: ['orderDetails', 'orderDetails.variant'],
      });

      console.log('[STEP 0] ORDER RESULT:', order ? 'FOUND' : 'NOT FOUND');

      if (!order) {
        throw new BadRequestException(`Order ${orderId} không tồn tại`);
      }

      /*
      =====================================
      1. PROVIDER
      =====================================
      */
      console.log('[STEP 1] Provider lookup...');

      const providerCode = 'AHAMOVE';

      let provider = await this.providersService
        .findByCode(providerCode)
        .catch((err) => {
          console.log('[STEP 1] Provider find error:', err);
          return null;
        });

      if (!provider) {
        console.log('[STEP 1] Provider not found → creating...');

        provider = await this.providersService.create({
          id: providerId || 'AHAMOVE',
          name: 'Ahamove',
          code: providerCode,
          status: 'Active',
        } as any);
      }

      console.log('[STEP 1] Provider:', provider);

      /*
      =====================================
      2. SERVICE
      =====================================
      */
      console.log('[STEP 2] Service resolve...');

      const serviceCode = extraPayload.service_id || 'SGN-BIKE';

      let service = await this.servicesService
        .findByCode(serviceCode)
        .catch((err) => {
          console.log('[STEP 2] Service find error:', err);
          return null;
        });

      if (!service) {
        console.log('[STEP 2] Service not found → creating...');

        service = await this.servicesService.create({
          id: serviceId || serviceCode,
          name: serviceCode,
          service_code: serviceCode,
          status: 'Active',
        } as any);
      }

      console.log('[STEP 2] Service:', service);

      /*
      =====================================
      3. BUILD ITEMS
      =====================================
      */
      console.log('[STEP 3] Build items...');

      const items = order.orderDetails.map((detail: any) => ({
        productId: detail.product_id,
        variantId: detail.product_variant_id,
        code: detail.code,
        name: detail.variant?.name || detail.name,
        color: detail.color,
        quantity: detail.quantity,
        price: Number(detail.price),
        total: Number(detail.price) * detail.quantity,
      }));

      console.log('[STEP 3] ITEMS:', JSON.stringify(items, null, 2));

      /*
      =====================================
      4. COD
      =====================================
      */
      const codAmount = order.orderDetails.reduce(
        (total: number, item: any) =>
          total + Number(item.price) * Number(item.quantity),
        0,
      );

      console.log('[STEP 4] COD:', codAmount);

      /*
      =====================================
      5. BUILD AHAMOVE PAYLOAD
      =====================================
      */
      console.log('[STEP 5] Build Ahamove payload...');

      const ahamovePayload = {
        order_time: 0,
        path: [
          {
            address: PICK_ADDRESS,
            mobile: PICK_MOBILE,
            name: 'TrueLook Store',
          },
          {
            address: extraPayload.drop_address,
            mobile: extraPayload.drop_mobile,
            name: extraPayload.drop_name,
            cod: codAmount,
          },
        ],
        service_id: serviceCode,
        payment_method: extraPayload.payment_method || 'CASH',
        remarks: extraPayload.remarks || '',
        promo_code: extraPayload.promo_code || '',
        requests: [],
        group_requests: [],
        items,
      };

      console.log(
        '[STEP 5] AHAMOVE PAYLOAD:',
        JSON.stringify(ahamovePayload, null, 2),
      );

      /*
      =====================================
      6. CREATE ORDER AHAMOVE
      =====================================
      */
      console.log('[STEP 6] Calling Ahamove API...');

      let ahamoveResult;

      try {
        ahamoveResult = await this.createAhamoveOrder(ahamovePayload);

        console.log('[STEP 6] AHAMOVE RESPONSE SUCCESS:');
        console.log(JSON.stringify(ahamoveResult, null, 2));
      } catch (err: any) {
        console.log('[STEP 6] AHAMOVE ERROR:');
        console.log(err?.response?.data || err.message || err);

        throw err;
      }

      /*
      =====================================
      7. SAVE SHIPPING
      =====================================
      */
      console.log('[STEP 7] Saving shipping...');

      const shippingId = String(Date.now());

      const newShipping = this.shippingRepo.create({
        id: shippingId,
        order_id: orderId,
        provider_id: provider.id,
        service_id: service.id,
        status: 'Pending',
        ship_fee: ahamoveResult?.raw?.order?.distance_price || 0,
        cod_amount: codAmount,
        ahamove_id: String(ahamoveResult?.order_id || ''),
        nhanh_id: String(ahamoveResult?.order_id || ''),
        tracking_url: ahamoveResult?.shared_link,
        create_at: new Date(),
        update_at: new Date(),
      } as any);

      console.log('[STEP 7] SHIPPING ENTITY:', newShipping);

      const savedShipping = await this.shippingRepo.save(newShipping);

      console.log('[STEP 7] SHIPPING SAVED SUCCESS:', savedShipping);

      /*
      =====================================
      8. RETURN
      =====================================
      */
      console.log('[STEP 8] DONE SUCCESS');

      return {
        success: true,
        ahamove_order: ahamoveResult,
        shipping: savedShipping,
      };
    } catch (error: any) {
      console.log('==============================');
      console.log('[AHAMOVE CHECKOUT ERROR]');
      console.log(error?.response?.data || error.message || error);
      console.log('==============================');

      throw error;
    }
  }

  async estimateAhamoveFee(
    extraPayload: any,
  ) {
    const PICK_ADDRESS =
      'Tòa Bs16, 88 Phước Thiện, Khu phố 29, Long Bình, Hồ Chí Minh 71300, Việt Nam';

    const PICK_MOBILE =
      '0822030768';

    try {

      /*
      =====================================
      VALIDATE INPUT
      =====================================
      */

      if (
        !extraPayload.cart_item_ids ||
        !Array.isArray(
          extraPayload.cart_item_ids,
        ) ||
        !extraPayload.cart_item_ids.length
      ) {
        throw new BadRequestException(
          'cart_item_ids is required',
        );
      }

      if (!extraPayload.ref_id) {
        throw new BadRequestException(
          'ref_id is required',
        );
      }

      if (!extraPayload.drop_mobile) {
        throw new BadRequestException(
          'drop_mobile is required',
        );
      }

      if (!extraPayload.drop_name) {
        throw new BadRequestException(
          'drop_name is required',
        );
      }

      if (
        !/^0\d{9}$/.test(
          extraPayload.drop_mobile,
        )
      ) {
        throw new BadRequestException(
          'Số điện thoại không hợp lệ',
        );
      }

      /*
      =====================================
      GET ADDRESS FROM VIETMAP
      =====================================
      */

      const placeResponse =
        await axios.get(
          'https://maps.vietmap.vn/api/place/v3',
          {
            params: {
              apikey:
                process.env.VIETMAP_API_KEY,
              refid:
                extraPayload.ref_id,
            },
          },
        );

      const place =
        placeResponse.data;

      if (!place) {
        throw new BadRequestException(
          'Không tìm thấy địa chỉ từ ref_id',
        );
      }

      const dropAddress =
        place.display ||
        place.address;

      const dropLat = Number(
        place.lat,
      );

      const dropLng = Number(
        place.lng,
      );

      /*
      =====================================
      GET CART ITEMS
      =====================================
      */

      const cartItems =
        await this.cartItemRepo
          .createQueryBuilder(
            'cartItem',
          )
          .leftJoinAndSelect(
            'cartItem.variant',
            'variant',
          )
          .where(
            'cartItem.id IN (:...ids)',
            {
              ids:
                extraPayload.cart_item_ids,
            },
          )
          .getMany();

      if (!cartItems.length) {
        throw new BadRequestException(
          'Không tìm thấy cart items',
        );
      }

      /*
      =====================================
      BUILD ITEMS
      =====================================
      */

      const items = cartItems.map(
        (
          item: any,
          index: number,
        ) => ({
          _id: String(index + 1),

          name:
            item.variant?.name ||
            'Product',

          price: Number(
            item.variant?.price || 0,
          ),

          num: Number(
            item.quantity,
          ),
        }),
      );

      /*
      =====================================
      BUILD AHAMOVE PAYLOAD
      =====================================
      */

      const payload = {
        order_time: 0,

        path: [
          {
            address:
              PICK_ADDRESS,

            mobile:
              PICK_MOBILE,

            name:
              'TrueLook Store',

            lat:
              10.847706,

            lng:
              106.83636,
          },

          {
            address:
              dropAddress,

            mobile:
              extraPayload.drop_mobile,

            name:
              extraPayload.drop_name,

            lat:
              dropLat,

            lng:
              dropLng,
          },
        ],

        services: [
          {
            _id:
              extraPayload.service_id ||
              'SGN-BIKE',

            requests: [],
          },
        ],

        payment_method:
          extraPayload.payment_method ||
          'CASH',

        remarks:
          extraPayload.remarks ||
          '',

        items,
      };

      /*
      =====================================
      CALL AHAMOVE
      =====================================
      */

      const headers =
        await this.getAhamoveAuthHeaders();

      const url =
        this.ahamoveUrl(
          '/v3/orders/estimates',
        );

      console.log(
        '===== AHAMOVE ESTIMATE =====',
      );

      console.log(
        JSON.stringify(
          payload,
          null,
          2,
        ),
      );

      const response =
        await axios.post(
          url,
          payload,
          {
            headers,
          },
        );

      const estimateData =
        response.data?.[0]?.data;

      if (!estimateData) {
        throw new BadRequestException(
          'Không lấy được phí vận chuyển',
        );
      }

      return {
        success: true,

        shipping_fee:
          estimateData.total_price || 0,

        distance:
          estimateData.distance || 0,

        duration:
          estimateData.duration || 0,

        drop_address:
          dropAddress,

        lat:
          dropLat,

        lng:
          dropLng,

        items,

        estimate_result:
          response.data,
      };
    } catch (error: any) {

      console.log(
        '===== ESTIMATE ERROR =====',
      );

      console.log(
        JSON.stringify(
          error.response?.data ||
          error.message,
          null,
          2,
        ),
      );

      throw this.mapAhamoveError(
        error,
      );
    }
  }

  async autocompleteAddress(
    extraPayload: any,
  ) {
    if (!extraPayload?.text) {
      throw new BadRequestException(
        'text is required',
      );
    }

    const response =
      await axios.get(
        'https://maps.vietmap.vn/api/autocomplete/v4',
        {
          params: {
            apikey:
              process.env.VIETMAP_API_KEY,
            text:
              extraPayload.text,
            display_type: 5,
          },
        },
      );

    return {
      success: true,
      results:
        response.data,
    };
  }
  // Service của giao hàng nhanh 
  async create(dto: CreateShippingDto): Promise<Shipping> {
    const newShipping = this.shippingRepo.create(dto);
    return await this.shippingRepo.save(newShipping);
  }

  async findAll(): Promise<Shipping[]> {
    return await this.shippingRepo.find();
  }

  async findOne(id: string): Promise<Shipping> {
    const shipping = await this.shippingRepo.findOneBy({ id });

    if (!shipping) {
      throw new NotFoundException(`Shipping với ID ${id} không tồn tại`);
    }

    return shipping;
  }

  async update(id: string, dto: UpdateShippingDto): Promise<Shipping> {
    const shipping = await this.findOne(id);
    const updated = Object.assign(shipping, dto);
    return await this.shippingRepo.save(updated);
  }

  async remove(id: string): Promise<{ message: string }> {
    const shipping = await this.findOne(id);
    await this.shippingRepo.remove(shipping);

    return {
      message: `Đã xóa thành công vận đơn ${id}`,
    };
  }

  /*
  =====================================================
  ĐỔI ACCESS CODE -> ACCESS TOKEN (V2)
  =====================================================
  */

  async getAccessToken(accessCode: string) {
    try {
      const response = await axios.post(
        'https://pos.open.nhanh.vn/api/oauth/access_token',
        null,
        {
          params: {
            version: '2.0',
            appId: process.env.NHANH_APP_ID,
            secretKey: process.env.NHANH_APP_SECRET,
            accessCode,
          },
        },
      );

      console.log('NHANH TOKEN RESPONSE:');
      console.log(response.data);

      if (response.data.code !== 1) {
        throw new Error(response.data.messages);
      }

      const data = response.data;

      const config = this.nhanhRepo.create({
        access_token: data.accessToken,
        business_id: data.businessId,
        expires_at: data.expiredAt,
      });

      await this.nhanhRepo.save(config);

      return {
        message: 'Connect Nhanh success',
        token: data.accessToken,
        businessId: data.businessId,
      };
    } catch (error: any) {
      console.log('NHANH TOKEN ERROR:');
      console.log(error.response?.data || error.message);
      throw error;
    }
  }

  /*
  =====================================================
  LẤY TOKEN MỚI NHẤT
  =====================================================
  */

  async getSavedToken() {
    const token = await this.nhanhRepo.find({
      order: { id: 'DESC' },
      take: 1,
    });

    if (!token.length) {
      throw new NotFoundException('Chưa có token Nhanh trong database');
    }

    return token[0];
  }

  /*
  =====================================================
  LẤY TỈNH / HUYỆN / XÃ (V2)
  =====================================================
  */

  async getLocation(type: string, parentId?: number) {
    const config = await this.getSavedToken();

    const queryType = type === 'PROVINCE' ? 'CITY' : type;

    const dataPayload: any = {
      type: queryType,
    };

    if (parentId) {
      dataPayload.parentId = Number(parentId);
    }

    const formPayload = new URLSearchParams();
    formPayload.append('version', '2.0');
    formPayload.append('appId', process.env.NHANH_APP_ID || '');
    formPayload.append('businessId', String(config.business_id));
    formPayload.append('accessToken', config.access_token);
    formPayload.append('data', JSON.stringify(dataPayload));

    try {
      const response = await axios.post(
        'https://pos.open.nhanh.vn/api/shipping/location',
        formPayload,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      console.log('===== NHANH LOCATION ERROR =====');
      console.log('status =', error.response?.status);
      console.log('data =', error.response?.data || error.message);
      throw error;
    }
  }

  /*
  =====================================================
  LẤY DANH SÁCH KHO (V2)
  =====================================================
  */

  async getDepots(depotId?: number) {
    const config = await this.getSavedToken();

    const formPayload = new URLSearchParams();
    formPayload.append('version', '2.0');
    formPayload.append('appId', process.env.NHANH_APP_ID || '');
    formPayload.append('businessId', String(config.business_id));
    formPayload.append('accessToken', config.access_token);
    formPayload.append(
      'data',
      JSON.stringify(depotId ? { depotId: Number(depotId) } : {}),
    );

    try {
      const response = await axios.post(
        'https://pos.open.nhanh.vn/api/store/depot',
        formPayload,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      console.log('===== NHANH DEPOT ERROR =====');
      console.log('status =', error.response?.status);
      console.log('data =', error.response?.data || error.message);
      throw error;
    }
  }

  /*
  =====================================================
  TÍNH PHÍ SHIP (V2)
  =====================================================
  */

  async calculateFee(data: any) {
    const config = await this.getSavedToken();

    const formPayload = new URLSearchParams();
    formPayload.append('version', '2.0');
    formPayload.append('appId', process.env.NHANH_APP_ID || '');
    formPayload.append('businessId', String(config.business_id));
    formPayload.append('accessToken', config.access_token);
    formPayload.append('data', JSON.stringify(data));

    try {
      const response = await axios.post(
        'https://pos.open.nhanh.vn/api/shipping/fee',
        formPayload,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      console.log('===== NHANH FEE ERROR =====');
      console.log('status =', error.response?.status);
      console.log('data =', error.response?.data || error.message);
      throw error;
    }
  }

  /*
  =====================================================
  TẠO ĐƠN GIAO HÀNG (V2)
  =====================================================
  */

  async createOrder(data: any) {
    const config = await this.getSavedToken();

    const formPayload = new URLSearchParams();
    formPayload.append('version', '2.0');
    formPayload.append('appId', process.env.NHANH_APP_ID || '');
    formPayload.append('businessId', String(config.business_id));
    formPayload.append('accessToken', config.access_token);
    // Ép kiểu JSON string cho chắc cú, đề phòng truyền object vào bị lỗi
    formPayload.append('data', typeof data === 'string' ? data : JSON.stringify(data));

    try {
      const response = await axios.post(
        'https://pos.open.nhanh.vn/api/order/add',
        formPayload,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      const responseData = response.data;

      // ĐIỂM TỬ HUYỆT: Nhanh.vn trả về 200 OK nhưng logic bị lỗi (code = 0)
      if (responseData.code === 0) {
        console.error('===== NHANH.VN LOGIC ERROR =====', responseData.messages);
        // Quăng lỗi ra ngoài kèm theo thông báo từ Nhanh.vn
        throw new Error(responseData.messages ? responseData.messages.join(', ') : 'Lỗi không xác định từ Nhanh.vn');
      }

      // Nếu code = 1 (Thành công), trả về cục data chứa orderId và trackingUrl
      return responseData.data;
    } catch (error: any) {
      console.log('===== NHANH CREATE ORDER ERROR =====');
      console.log(error.message);
      throw error; // Ném lỗi văng ra ngoài để Controller xử lý
    }
  }

  /*
  =====================================================
  LẤY DANH SÁCH ĐƠN HÀNG (V2) - TỪ NHANH.VN
  =====================================================
  */
  async getNhanhOrders(data: any) {
    const config = await this.getSavedToken();

    const formPayload = new URLSearchParams();
    formPayload.append('version', '2.0');
    formPayload.append('appId', process.env.NHANH_APP_ID || '');
    formPayload.append('businessId', String(config.business_id));
    formPayload.append('accessToken', config.access_token);
    formPayload.append('data', typeof data === 'string' ? data : JSON.stringify(data));

    try {
      const response = await axios.post(
        'https://pos.open.nhanh.vn/api/order/index',
        formPayload,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      const responseData = response.data;

      // Xử lý logic khi Nhanh.vn báo code = 0
      if (responseData.code === 0) {

        // 1. Nếu đơn giản là "Không có đơn hàng", trả về mảng rỗng cho frontend
        if (responseData.messages && responseData.messages.includes('No records')) {
          console.log('[Nhanh.vn] Không có đơn hàng nào trong khoảng thời gian này.');
          return {
            totalPages: 0,
            orders: {} // Nhanh.vn thường trả về object chứa các đơn, hoặc mảng
          };
        }

        // 2. Nếu là lỗi thật sự (Sai token, thiếu tham số...) thì ném lỗi 400
        console.error('===== NHANH.VN GET ORDERS ERROR =====', responseData.messages);
        throw new BadRequestException(
          responseData.messages ? responseData.messages.join(', ') : 'Lỗi lấy danh sách đơn từ Nhanh.vn'
        );
      }

      // Trả về danh sách đơn hàng bình thường nếu có dữ liệu
      return responseData.data;
    } catch (error: any) {
      console.log('===== NHANH GET ORDERS CATCH ERROR =====');
      console.log(error.message);

      // Giữ nguyên lỗi 400 nếu mình chủ động ném ra ở trên
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(error.response?.data || error.message);
    }
  }

  async updateNhanhOrder(data: any) {
    const config = await this.getSavedToken();

    const formPayload = new URLSearchParams();
    formPayload.append('version', '2.0');
    formPayload.append('appId', process.env.NHANH_APP_ID || '');
    formPayload.append('businessId', String(config.business_id));
    formPayload.append('accessToken', config.access_token);
    // Parse data JSON y như hình Postman của ông
    formPayload.append('data', typeof data === 'string' ? data : JSON.stringify(data));

    try {
      const response = await axios.post(
        'https://pos.open.nhanh.vn/api/order/update',
        formPayload,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      const responseData = response.data;

      // Vẫn là cái bẫy quen thuộc: HTTP 200 nhưng code = 0
      if (responseData.code === 0) {
        console.error('===== NHANH.VN UPDATE ORDER ERROR =====', responseData.messages);
        throw new BadRequestException(
          responseData.messages ? responseData.messages.join(', ') : 'Lỗi cập nhật đơn trên Nhanh.vn'
        );
      }

      // Trả về data (chứa orderId và status mới)
      return responseData.data;
    } catch (error: any) {
      console.log('===== NHANH UPDATE ORDER CATCH ERROR =====');
      console.log(error.message);

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(error.response?.data || error.message);
    }
  }

  async processCheckoutShipping(
    orderId: string,
    providerId: string,
    serviceId: string,
    nhanhPayload: any
  ) {
    // 1. Validate xem Provider và Service có tồn tại trong DB nội bộ không
    // (Logic check tồn tại viết bên service của nó)
    const provider = await this.providersService.findOne(providerId);
    const service = await this.servicesService.findOne(serviceId);

    if (!provider || !service) {
      throw new BadRequestException('Hãng vận chuyển hoặc Dịch vụ không hợp lệ');
    }

    // 2. Bắn data qua Nhanh.vn (Kèm CarrierId và ServiceId của Nhanh nếu cần)
    const nhanhResult = await this.createOrder(nhanhPayload);

    // 3. Nhanh.vn báo OK -> Lưu dữ liệu tổng hợp vào bảng `shipping`
    const newShipping = this.shippingRepo.create({
      id: orderId, // Hoặc tự gen ID vận đơn riêng tùy ông
      order_id: orderId,
      provider_id: provider.id,
      service_id: service.id,
      ship_fee: nhanhResult.shipFee || 0,
      cod_amount: nhanhPayload.codMoney || 0,
      status: 'ReadyToPick', // Trạng thái mặc định khi vừa book xong
      // Lưu lại 2 trường tracking nếu ông đã tạo trong entity
      // nhanh_id: String(nhanhResult.orderId), 
      // tracking_url: nhanhResult.trackingUrl,
    });

    // 4. Lưu thành công và trả về cho Frontend
    return await this.shippingRepo.save(newShipping);
  }

  /*
  =====================================================
  XỬ LÝ WEBHOOK TỪ NHANH.VN BÁO VỀ (TỰ ĐỘNG CẬP NHẬT TRẠNG THÁI)
  =====================================================
  */
  async handleNhanhWebhook(payload: any) {
    console.log('===== NHANH WEBHOOK GÕ CỬA =====', payload);

    const nhanhOrderId = payload.data?.orderId || payload.orderId;
    const nhanhStatus = payload.data?.status || payload.status;

    if (!nhanhOrderId || !nhanhStatus) {
      return { message: 'Dữ liệu webhook không hợp lệ, bỏ qua!' };
    }

    // 1. Tìm đơn hàng nội bộ qua nhanh_id
    // LƯU Ý: Entity Shipping của ông phải có cột `nhanh_id` nhé
    const shippingRecord = await this.shippingRepo.findOne({
      where: { nhanh_id: String(nhanhOrderId) } as any // Ép kiểu any tạm nếu Entity chưa khai báo nhanh_id
    });

    if (!shippingRecord) {
      console.log(`[Webhook] Không tìm thấy đơn nội bộ nào khớp với mã Nhanh.vn: ${nhanhOrderId}`);
      return { message: 'Không tìm thấy đơn' };
    }

    // 2. Map trạng thái của Nhanh.vn sang trạng thái nội bộ
    let localStatus = shippingRecord.status;
    switch (nhanhStatus) {
      case 'Pickup':
        localStatus = 'Delivering';
        break;
      case 'Success':
        localStatus = 'Delivered';
        break;
      case 'Returned':
        localStatus = 'Returned';
        break;
      case 'Canceled':
      case 'Aborted':
        localStatus = 'Canceled';
        break;
    }

    // 3. Cập nhật DB
    shippingRecord.status = localStatus;
    shippingRecord.update_at = new Date();

    await this.shippingRepo.save(shippingRecord);

    console.log(`[Webhook] Đã tự động cập nhật đơn ${shippingRecord.id} -> ${localStatus}`);
    return { success: true };
  }

  /*
  =====================================================
  TẠO ĐƠN NHANH.VN & TỰ ĐỘNG LƯU VÀO 3 BẢNG DB (BẢN FIX LỖI DUPLICATE)
  =====================================================
  */
  async saveAllDataToDb(body: any) {
    // --- 1. XỬ LÝ PROVIDER ---
    const carrierId = body.carrierId ? String(body.carrierId) : '1';
    const carrierName = body.carrierName || 'J&T Express';
    const carrierCode = carrierName.toUpperCase().replace(/\s/g, '_');

    let provider;
    // Tìm theo ID trước
    provider = await this.providersService.findOne(carrierId).catch(() => null);

    // Nếu ID ko có, gọi hàm findByCode vừa tạo ở Bước 1
    if (!provider) {
      provider = await this.providersService.findByCode(carrierCode).catch(() => null);
    }

    // Nếu vẫn ko có thì mới tạo mới
    if (!provider) {
      provider = await this.providersService.create({
        id: carrierId,
        name: carrierName,
        code: carrierCode,
        status: 'Active'
      } as any);
      console.log('=> Tạo mới Provider thành công');
    }

    // --- 2. XỬ LÝ SERVICE ---
    const serviceId = body.serviceId ? String(body.serviceId) : '1';
    const serviceName = body.serviceName || 'Giao chuẩn';
    const serviceCode = serviceName.toUpperCase().replace(/\s/g, '_');

    let service;
    // Tìm theo ID
    service = await this.servicesService.findOne(serviceId).catch(() => null);

    // Tìm theo Code bằng hàm vừa tạo ở Bước 2
    if (!service) {
      service = await this.servicesService.findByCode(serviceCode).catch(() => null);
    }

    if (!service) {
      service = await this.servicesService.create({
        id: serviceId,
        name: serviceName,
        service_code: serviceCode,
        status: 'Active'
      } as any);
      console.log('=> Tạo mới Service thành công');
    }

    // --- 3. BẮN DATA SANG NHANH.VN ---
    const nhanhResult = await this.createOrder(body);

    // --- 4. LƯU THÔNG TIN VẬN ĐƠN (SHIPPING) ---
    const newShipping = this.shippingRepo.create({
      id: body.id,
      order_id: body.id,
      status: 'ReadyToPick',
      ship_fee: nhanhResult.shipFee || 0,
      cod_amount: body.moneyTransfer === 0
        ? body.productList.reduce((sum: number, p: any) => sum + p.price * p.quantity, 0)
        : 0,
      nhanh_id: String(nhanhResult.orderId),
      tracking_url: nhanhResult.trackingUrl,
      provider_id: provider.id,
      service_id: service.id
    } as any);

    const savedShipping = await this.shippingRepo.save(newShipping);

    return {
      message: 'Done! Hệ thống True Look đã ghi nhận đủ 3 bảng.',
      db_shipping: savedShipping
    };
  }

  async updateStatusFromWebhook(orderId: string, status: string) {
    return await this.shippingRepo.update(
      { nhanh_id: String(orderId) },
      { status: status }
    );
  }

}