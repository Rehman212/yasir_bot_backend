import {
  IsString,
  IsOptional,
  IsEnum,
  IsObject,
  MaxLength,
} from 'class-validator';
import { NotificationType } from '../../common/enums';

export class CreateNotificationDto {
  @IsEnum(NotificationType)
  type: NotificationType;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsString()
  @MaxLength(2000)
  message: string;

  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}
