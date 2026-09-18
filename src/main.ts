import { createExpressApp } from './server';

async function bootstrap() {
  console.log('Bootstrapping SheetPress API...');
  const server = await createExpressApp();
  const port = Number(process.env.PORT ?? 4000);
  server.listen(port, '0.0.0.0', () => {
    console.log(`API running on http://localhost:${port}/api`);
  });
}

bootstrap().catch((err) => {
  console.error('API bootstrap failed:', err);
  process.exit(1);
});
