import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ImportsService } from './imports.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  GoogleSheetsImportDto,
  ValidateImportDto,
} from './dto/import.dto';

@Controller('imports')
@UseGuards(JwtAuthGuard)
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  upload(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('siteId') siteIdQuery?: string,
    @Body('siteId') siteIdBody?: string,
    @Body('columnMapping') columnMapping?: string,
  ) {
    const siteId = (siteIdQuery || siteIdBody || '').trim();
    if (!siteId) {
      throw new BadRequestException('siteId is required');
    }
    if (!file) {
      throw new BadRequestException('file is required');
    }

    let mapping: Record<string, string> | undefined;
    if (columnMapping) {
      try {
        mapping =
          typeof columnMapping === 'string'
            ? JSON.parse(columnMapping)
            : columnMapping;
      } catch {
        mapping = undefined;
      }
    }
    return this.importsService.uploadFile(userId, siteId, file, mapping);
  }

  @Post('google-sheets')
  googleSheets(
    @CurrentUser('id') userId: string,
    @Body() dto: GoogleSheetsImportDto,
  ) {
    return this.importsService.importGoogleSheets(
      userId,
      dto.sheetUrl,
      dto.siteId,
      dto.columnMapping,
    );
  }

  @Get('history')
  history(@CurrentUser('id') userId: string) {
    return this.importsService.history(userId);
  }

  @Get(':id')
  getBatch(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.importsService.getBatch(userId, id);
  }

  @Post('validate')
  validate(
    @CurrentUser('id') userId: string,
    @Body() dto: ValidateImportDto,
  ) {
    return this.importsService.validateMapping(
      userId,
      dto.batchId,
      dto.columnMapping,
    );
  }
}
