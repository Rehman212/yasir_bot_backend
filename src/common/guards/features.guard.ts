import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../enums';
import { FEATURE_KEY } from '../decorators/require-feature.decorator';
import { ROUTE_FEATURE_MAP, type AppFeature } from '../features';

@Injectable()
export class FeaturesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as
      | {
          role?: string;
          deniedFeatures?: string[];
        }
      | undefined;

    if (!user) return true;
    if (user.role === UserRole.ADMIN) return true;

    const explicit = this.reflector.getAllAndOverride<AppFeature | undefined>(
      FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );

    let feature = explicit;
    if (!feature) {
      const url: string = String(
        request.originalUrl || request.url || request.route?.path || '',
      );
      const cleaned = url
        .split('?')[0]
        .replace(/^\/api\//, '/')
        .replace(/^\//, '');
      const prefix = cleaned.split('/').filter(Boolean)[0];
      if (prefix && ROUTE_FEATURE_MAP[prefix]) {
        feature = ROUTE_FEATURE_MAP[prefix];
      }
    }

    if (!feature) return true;

    const denied = user.deniedFeatures || [];
    if (denied.includes(feature)) {
      throw new ForbiddenException(
        `You do not have permission to access "${feature}"`,
      );
    }
    return true;
  }
}
