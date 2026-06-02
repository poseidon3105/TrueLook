import {
  BeforeInsert,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('addresses')
export class Address {
  @PrimaryColumn({ type: 'varchar', length: 15 })
  id: string;

  @Column({ name: 'user_id', type: 'varchar', length: 15 })
  user_id: string;

  @Column({ type: 'varchar' })
  name_recipient: string;

  @Column({ type: 'varchar' })
  phone_recipient: string;

  @Column({ type: 'varchar' })
  city: string;

  @Column({ type: 'varchar' })
  district: string;

  @Column({ type: 'varchar' })
  ward: string;

  @Column({ type: 'varchar' })
  street: string;

  @Column({ type: 'varchar' })
  note: string;

  @Column({ type: 'varchar' })
  role: string;

  @Column({
    nullable: true,
    type: 'varchar',
    length: 500,
  })
  ref_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user: User;

  @BeforeInsert()
  generateId() {
    this.id = Date.now().toString();
  }
}
