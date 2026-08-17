import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TaxonomyService } from './taxonomy.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  SyncTaxonomyDto,
  CreateTaxonomyTermDto,
} from './dto/taxonomy.dto';
import { TaxonomyType } from '../common/enums';

@Controller('taxonomy')
@UseGuards(JwtAuthGuard)
export class TaxonomyController {
  constructor(private readonly taxonomyService: TaxonomyService) {}

  @Post('sync')
  sync(@CurrentUser('id') userId: string, @Body() dto: SyncTaxonomyDto) {
    return this.taxonomyService.sync(userId, dto.siteId, dto.type);
  }

  @Post()
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateTaxonomyTermDto,
  ) {
    return this.taxonomyService.createMissing(userId, dto);
  }

  @Get()
  list(
    @CurrentUser('id') userId: string,
    @Query('siteId') siteId: string,
    @Query('type') type?: TaxonomyType,
  ) {
    return this.taxonomyService.list(userId, siteId, type);
  }
}
