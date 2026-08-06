import 'reflect-metadata';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { HealthController } from '../src/app/health.controller.js';

@Module({ controllers: [HealthController] })
class TestHealthModule {}

describe('GET /healthz', () => {
  let app: INestApplication;
  let http: App;

  beforeAll(async () => {
    app = await NestFactory.create(TestHealthModule, { logger: false });
    await app.init();
    http = app.getHttpServer() as App;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 { status: "ok" } without authentication or dependencies', async () => {
    await request(http).get('/healthz').expect(200).expect({ status: 'ok' });
  });
});