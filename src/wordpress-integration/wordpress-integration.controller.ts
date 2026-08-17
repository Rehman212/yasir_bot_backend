import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Res,
  UseGuards,
  ParseIntPipe,
  StreamableFile,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import { join } from 'path';
import { WordPressIntegrationService } from './wordpress-integration.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  CreatePostDto,
  UpdatePostDto,
  CreateTaxonomyDto,
} from './dto/wp-post.dto';

@Controller('wordpress-integration')
@UseGuards(JwtAuthGuard)
export class WordPressIntegrationController {
  constructor(private readonly wp: WordPressIntegrationService) {}

  @Get('seo-bridge/download')
  downloadSeoBridge(@Res({ passthrough: true }) res: Response) {
    const candidates = [
      join(process.cwd(), 'wordpress-plugin', 'sheetpress-seo-bridge.zip'),
      join(
        __dirname,
        '..',
        '..',
        'wordpress-plugin',
        'sheetpress-seo-bridge.zip',
      ),
    ];
    const filePath = candidates.find((p) => existsSync(p));
    if (!filePath) {
      throw new NotFoundException(
        'sheetpress-seo-bridge.zip not found on server',
      );
    }
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition':
        'attachment; filename="sheetpress-seo-bridge.zip"',
    });
    return new StreamableFile(createReadStream(filePath));
  }

  @Get(':siteId/seo-bridge')
  checkSeoBridge(
    @CurrentUser('id') userId: string,
    @Param('siteId') siteId: string,
  ) {
    return this.wp.checkSeoBridge(siteId, userId);
  }

  @Post(':siteId/posts')
  createPost(
    @CurrentUser('id') userId: string,
    @Param('siteId') siteId: string,
    @Body() dto: CreatePostDto,
  ) {
    return this.wp.createPost(siteId, dto, userId);
  }

  @Patch(':siteId/posts/:postId')
  updatePost(
    @CurrentUser('id') userId: string,
    @Param('siteId') siteId: string,
    @Param('postId', ParseIntPipe) postId: number,
    @Body() dto: UpdatePostDto,
  ) {
    return this.wp.updatePost(siteId, postId, dto, userId);
  }

  @Delete(':siteId/posts/:postId')
  deletePost(
    @CurrentUser('id') userId: string,
    @Param('siteId') siteId: string,
    @Param('postId', ParseIntPipe) postId: number,
  ) {
    return this.wp.deletePost(siteId, postId, userId);
  }

  @Get(':siteId/categories')
  fetchCategories(
    @CurrentUser('id') userId: string,
    @Param('siteId') siteId: string,
  ) {
    return this.wp.fetchCategories(siteId, userId);
  }

  @Post(':siteId/categories')
  createCategory(
    @CurrentUser('id') userId: string,
    @Param('siteId') siteId: string,
    @Body() dto: CreateTaxonomyDto,
  ) {
    return this.wp.createCategory(siteId, dto, userId);
  }

  @Get(':siteId/tags')
  fetchTags(
    @CurrentUser('id') userId: string,
    @Param('siteId') siteId: string,
  ) {
    return this.wp.fetchTags(siteId, userId);
  }

  @Post(':siteId/tags')
  createTag(
    @CurrentUser('id') userId: string,
    @Param('siteId') siteId: string,
    @Body() dto: CreateTaxonomyDto,
  ) {
    return this.wp.createTag(siteId, dto, userId);
  }

  @Get(':siteId/authors')
  fetchAuthors(
    @CurrentUser('id') userId: string,
    @Param('siteId') siteId: string,
  ) {
    return this.wp.fetchAuthors(siteId, userId);
  }

  @Get(':siteId/posts/:postId/status')
  checkPostStatus(
    @CurrentUser('id') userId: string,
    @Param('siteId') siteId: string,
    @Param('postId', ParseIntPipe) postId: number,
  ) {
    return this.wp.checkPostStatus(siteId, postId, userId);
  }

  @Get(':siteId/posts/:postId/url')
  getPublishedUrl(
    @CurrentUser('id') userId: string,
    @Param('siteId') siteId: string,
    @Param('postId', ParseIntPipe) postId: number,
  ) {
    return this.wp.getPublishedUrl(siteId, postId, userId);
  }
}
