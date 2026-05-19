const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '../..');

describe('Docker & Docker Compose', () => {
  it('should have main Dockerfile', () => {
    const dockerfile = path.join(rootDir, 'Dockerfile');
    assert.ok(fs.existsSync(dockerfile), 'Dockerfile exists');
    const content = fs.readFileSync(dockerfile, 'utf8');
    assert.ok(content.includes('node:20-alpine'), 'Node 20 base image');
    assert.ok(content.includes('AS builder') || content.includes('AS production'), 'Multi-stage build');
    assert.ok(content.includes('HEALTHCHECK'), 'Health check configured');
    assert.ok(content.includes('dumb-init'), 'dumb-init for signal handling');
  });

  it('should have dashboard Dockerfile', () => {
    const dockerfile = path.join(rootDir, 'apps/web/Dockerfile');
    assert.ok(fs.existsSync(dockerfile), 'Dashboard Dockerfile exists');
    const content = fs.readFileSync(dockerfile, 'utf8');
    assert.ok(content.includes('standalone'), 'Next.js standalone output');
  });

  it('should have docker-compose.yml', () => {
    const compose = path.join(rootDir, 'docker-compose.yml');
    assert.ok(fs.existsSync(compose), 'docker-compose.yml exists');
    const content = fs.readFileSync(compose, 'utf8');
    assert.ok(content.includes('postgres'), 'PostgreSQL service');
    assert.ok(content.includes('redis'), 'Redis service');
    assert.ok(content.includes('healthcheck'), 'Health checks');
    assert.ok(content.includes('restart'), 'Restart policies');
  });

  it('should have docker-compose.prod.yml', () => {
    const compose = path.join(rootDir, 'docker-compose.prod.yml');
    assert.ok(fs.existsSync(compose), 'docker-compose.prod.yml exists');
    const content = fs.readFileSync(compose, 'utf8');
    assert.ok(content.includes('nginx'), 'Nginx reverse proxy');
    assert.ok(content.includes('deploy'), 'Deployment constraints');
    assert.ok(content.includes('volumes'), 'Named volumes');
  });

  it('should have nginx.conf', () => {
    const nginx = path.join(rootDir, 'nginx.conf');
    assert.ok(fs.existsSync(nginx), 'nginx.conf exists');
    const content = fs.readFileSync(nginx, 'utf8');
    assert.ok(content.includes('upstream'), 'Load balancer upstream');
    assert.ok(content.includes('443 ssl'), 'SSL configuration');
    assert.ok(content.includes('proxy_pass'), 'Reverse proxy');
  });

  it('should have .dockerignore', () => {
    const ignore = path.join(rootDir, '.dockerignore');
    assert.ok(fs.existsSync(ignore), '.dockerignore exists');
    const content = fs.readFileSync(ignore, 'utf8');
    assert.ok(content.includes('node_modules'), 'Ignore node_modules');
    assert.ok(content.includes('.env'), 'Ignore .env files');
    assert.ok(content.includes('.git'), 'Ignore .git');
  });
});
