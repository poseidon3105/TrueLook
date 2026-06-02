import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { Address } from './entities/address.entity';

@Injectable()
export class AddressesService {
  constructor(
    @InjectRepository(Address)
    private readonly addressesRepository: Repository<Address>,
  ) { }

  async create(
    userId: string,
    dto: CreateAddressDto,
  ) {
    const newAddress =
      this.addressesRepository.create({
        ...dto,
        user_id: userId,
        ref_id: dto.ref_id ,
      });

    return this.addressesRepository.save(
      newAddress,
    );
  }

  async findAll(userId: string) {
    return this.addressesRepository.find({
      where: { user_id: userId },
    });
  }

  async update(
    userId: string,
    addressId: string,
    dto: UpdateAddressDto,
  ) {
    const address =
      await this.addressesRepository.findOne({
        where: {
          id: addressId,
          user_id: userId,
        },
      });

    if (!address) {
      throw new NotFoundException(
        'Không tìm thấy địa chỉ này!',
      );
    }

    Object.assign(address, dto);

    return this.addressesRepository.save(
      address,
    );
  }

  async remove(userId: string, addressId: string) {
    const result = await this.addressesRepository.delete({
      id: addressId,
      user_id: userId,
    });

    if (result.affected === 0) {
      throw new NotFoundException('Không tìm thấy địa chỉ để xóa!');
    }

    return { message: 'Đã xóa địa chỉ thành công' };
  }
}
