import {
  IsOptional,
  IsString,
  MaxLength,
  IsObject,
  MinLength,
} from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsObject()
  preferences?: Record<string, unknown>;
}
