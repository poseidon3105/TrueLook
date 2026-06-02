import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class CreateAddressDto {
  @ApiProperty({ example: 'Tân Huỳnh', description: 'Tên người nhận' })
  @IsNotEmpty({ message: 'Tên người nhận không được để trống' })
  @IsString()
  name_recipient: string;

  @ApiProperty({
    example: '0901234567',
    description: 'Số điện thoại người nhận',
  })
  @IsNotEmpty({ message: 'Số điện thoại không được để trống' })
  // Regex kiểm tra số điện thoại chuẩn mạng Việt Nam
  @Matches(/(84|0[3|5|7|8|9])+([0-9]{8})\b/, {
    message: 'Số điện thoại không hợp lệ',
  })
  phone_recipient: string;

  @ApiProperty({ example: 'Hồ Chí Minh', description: 'Tỉnh/Thành phố' })
  @IsNotEmpty({ message: 'Tỉnh/Thành phố không được để trống' })
  @IsString()
  city: string;

  @ApiProperty({ example: 'Quận 1', description: 'Quận/Huyện' })
  @IsString()
  district: string;

  @ApiProperty({ example: 'Phường Bến Nghé', description: 'Phường/Xã' })
  @IsString()
  ward: string;

  @ApiProperty({
    example: '123 Đường Lê Lợi',
    description: 'Số nhà, Tên đường',
  })
  @IsNotEmpty({ message: 'Số nhà, Tên đường không được để trống' })
  @IsString()
  street: string;

  @ApiProperty({
    example: 'Giao giờ hành chính',
    required: false,
    description: 'Ghi chú giao hàng',
  })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiProperty({
    example: 'Nhà riêng',
    description: 'Loại địa chỉ (VD: Nhà riêng, Văn phòng)',
  })
  @IsNotEmpty({ message: 'Loại địa chỉ (role) không được để trống' })
  @IsString()
  role: string;

  @IsString()
  ref_id?: string;
}
