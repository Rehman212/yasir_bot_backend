import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { WordPressSitesService } from './wordpress-sites.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';

@Controller('wordpress-sites')
@UseGuards(JwtAuthGuard)
export class WordPressSitesController {
  constructor(private readonly sitesService: WordPressSitesService) {}

  @Post()
  create(@CurrentUser('id') userId: string, @Body() dto: CreateSiteDto) {
    return this.sitesService.create(userId, dto);
  }

  @Get()
  findAll(@CurrentUser('id') userId: string) {
    return this.sitesService.findAll(userId);
  }

  @Get(':id')
  findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.sitesService.findOne(userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSiteDto,
  ) {
    return this.sitesService.update(userId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.sitesService.remove(userId, id);
  }

  @Post(':id/test-connection')
  testConnection(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.sitesService.testConnection(userId, id);
  }

  @Get(':id/info')
  fetchWpInfo(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.sitesService.fetchWpInfo(userId, id);
  }
}
