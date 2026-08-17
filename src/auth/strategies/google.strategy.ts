import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    const clientID = config.get<string>('GOOGLE_CLIENT_ID') || 'disabled';
    const clientSecret =
      config.get<string>('GOOGLE_CLIENT_SECRET') || 'disabled';
    const callbackURL =
      config.get<string>('GOOGLE_CALLBACK_URL') ||
      'http://localhost:4000/api/auth/google/callback';

    super({
      clientID,
      clientSecret,
      callbackURL,
      scope: ['email', 'profile'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ) {
    const email = profile.emails?.[0]?.value;
    done(null, {
      googleId: profile.id,
      email,
      name: profile.displayName,
      picture: profile.photos?.[0]?.value,
    });
  }
}
