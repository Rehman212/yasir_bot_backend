import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type PublicSiteSettings = {
  companyName: string;
  companyUrl: string;
  companyDisplay: string;
  whatsappNumber: string;
  whatsappLink: string;
  promoPopupEnabled: boolean;
};

function toWhatsappLink(number: string) {
  const digits = number.replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : 'https://wa.me/';
}

@Injectable()
export class SiteSettingsService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureDefaults();
  }

  async ensureDefaults() {
    await this.prisma.siteSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default' },
      update: {},
    });
  }

  private format(row: {
    companyName: string;
    companyUrl: string;
    companyDisplay: string;
    whatsappNumber: string;
    promoPopupEnabled: boolean;
  }): PublicSiteSettings {
    return {
      companyName: row.companyName,
      companyUrl: row.companyUrl,
      companyDisplay: row.companyDisplay,
      whatsappNumber: row.whatsappNumber,
      whatsappLink: toWhatsappLink(row.whatsappNumber),
      promoPopupEnabled: row.promoPopupEnabled,
    };
  }

  async getPublic() {
    await this.ensureDefaults();
    const row = await this.prisma.siteSettings.findUniqueOrThrow({
      where: { id: 'default' },
    });
    return { data: this.format(row) };
  }

  async update(input: {
    companyName?: string;
    companyUrl?: string;
    companyDisplay?: string;
    whatsappNumber?: string;
    promoPopupEnabled?: boolean;
  }) {
    await this.ensureDefaults();
    const row = await this.prisma.siteSettings.update({
      where: { id: 'default' },
      data: {
        ...(input.companyName !== undefined && {
          companyName: input.companyName.trim() || 'Social Velocityy',
        }),
        ...(input.companyUrl !== undefined && {
          companyUrl: input.companyUrl.trim() || 'https://socialvelocityy.com',
        }),
        ...(input.companyDisplay !== undefined && {
          companyDisplay:
            input.companyDisplay.trim() || 'Socialvelocityy.com',
        }),
        ...(input.whatsappNumber !== undefined && {
          whatsappNumber: input.whatsappNumber.trim() || '+923156679495',
        }),
        ...(input.promoPopupEnabled !== undefined && {
          promoPopupEnabled: !!input.promoPopupEnabled,
        }),
      },
    });
    return { data: this.format(row) };
  }
}
