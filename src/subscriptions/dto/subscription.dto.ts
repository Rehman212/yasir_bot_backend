import { IsEnum, IsOptional } from 'class-validator';
import { PlanType } from '../../common/enums';

export class ChangePlanDto {
  @IsEnum(PlanType)
  plan: PlanType;
}
