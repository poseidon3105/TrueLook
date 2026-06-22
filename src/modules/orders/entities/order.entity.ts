import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { OneToMany } from 'typeorm';
import { OrderDetail } from '../../order_details/entities/order_detail.entity';
import { Payment } from '../../payments/entities/payment.entity';

@Entity('orders')
export class Order {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id: string;

  @Column({ name: 'customer_id', type: 'varchar', length: 15 })
  customer_id: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  total: number;

  @Column({ name: 'extra_fee', type: 'numeric', precision: 12, scale: 2 })
  extra_fee: number;

  @Column({ name: 'update_at', type: 'timestamp', nullable: true })
  update_at: Date;

  @Column({
    name: 'create_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  create_at: Date;

  @Column({
    name: 'ref_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  ref_id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'customer_id', referencedColumnName: 'id' })
  customer: User;
  @OneToMany(() => OrderDetail, (detail) => detail.order)
  orderDetails: OrderDetail[];
  @OneToMany(() => Payment, (payment) => payment.order)
  payments: Payment[];

  @BeforeInsert()
  generateId() {
    this.id = Date.now().toString();
  }

  @BeforeUpdate()
  updateTimestamp() {
    this.update_at = new Date();
  }

  @Column({
    type: 'varchar',
    length: 20,
    default: 'Pending'
  })
  status: string;

}