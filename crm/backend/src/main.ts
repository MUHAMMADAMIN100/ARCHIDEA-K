import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import compression = require('compression');
import { AppModule } from './app.module';

async function bootstrap() {
  // bodyParser отключаем, чтобы подключить ТОЛЬКО json: форменные тела
  // (urlencoded/multipart) — это «простые» кросс-сайтовые запросы без
  // preflight, то есть готовый вектор CSRF. Нам они не нужны.
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // За прокси Railway — чтобы Secure-cookie и protocol определялись верно
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', 1);
  expressApp.disable('x-powered-by'); // не раскрываем стек

  // Заголовки безопасности. API потребляется кросс-доменно (Vercel ↔ Railway),
  // поэтому CORP=cross-origin (иначе браузер заблокирует ответы), а CSP не нужна
  // (отдаём только JSON) — оставляем HSTS/nosniff/frameguard и пр.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // API отдаёт только JSON — запрещаем всё, чтобы ответ нельзя было
      // превратить в исполняемую страницу, и запрещаем встраивание во фрейм
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'none'"],
          'form-action': ["'none'"],
        },
      },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
    }),
  );
  /*
   * Сжатие ответов. Поток событий из него исключён: compression копит
   * данные в буфере перед отправкой, и живой канал молчал бы, пока буфер
   * не наберётся, — то есть фактически никогда.
   */
  app.use(
    compression({
      filter: (req: any, res: any) =>
        String(req.path || '').startsWith('/api/events')
          ? false
          : compression.filter(req, res),
    }),
  );

  // только JSON и с ограничением размера — защита от «раздутых» тел
  app.use(json({ limit: '256kb' }));

  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  // CORS — разрешаем фронт CRM и лендинг, с куками
  const origins = [
    process.env.FRONTEND_URL,
    process.env.LANDING_URL,
    'http://localhost:5173',
    'http://localhost:5174',
  ].filter((o): o is string => Boolean(o));

  app.enableCors({
    origin: origins,
    credentials: true,
  });

  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`🚀 Archidea CRM API запущен на порту ${port}`);
}
bootstrap();
