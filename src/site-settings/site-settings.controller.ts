import { Controller, Get } from '@nestjs/common';
import { SiteSettingsService } from './site-settings.service';

@Controller('site-settings')
export class SiteSettingsController {
  constructor(private readonly siteSettings: SiteSettingsService) {}

  /** Public — used by marketing footer, contact, and promo popup. */
  @Get()
  getPublic() {
    return this.siteSettings.getPublic();
  }
}
