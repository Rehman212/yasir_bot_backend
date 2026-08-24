/** Nav / module feature keys used for per-user deny permissions. */
export const APP_FEATURES = [
  'sites',
  'import',
  'articles',
  'queue',
  'calendar',
  'media',
  'templates',
  'activity',
  'subscription',
  'settings',
] as const;

export type AppFeature = (typeof APP_FEATURES)[number];

export const FEATURE_LABELS: Record<AppFeature, string> = {
  sites: 'WordPress Sites',
  import: 'Import Articles',
  articles: 'All Articles',
  queue: 'Publishing Queue',
  calendar: 'Content Calendar',
  media: 'Media',
  templates: 'Templates',
  activity: 'Activity Logs',
  subscription: 'Subscription',
  settings: 'Settings',
};

/** Map API controller path prefix → feature key. */
export const ROUTE_FEATURE_MAP: Record<string, AppFeature> = {
  'wordpress-sites': 'sites',
  'wordpress-integration': 'sites',
  imports: 'import',
  articles: 'articles',
  publishing: 'articles',
  queue: 'queue',
  scheduler: 'calendar',
  media: 'media',
  templates: 'templates',
  'audit-logs': 'activity',
  subscriptions: 'subscription',
  users: 'settings',
};
