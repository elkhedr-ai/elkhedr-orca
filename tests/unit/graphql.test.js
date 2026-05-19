const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { ApolloServer } = require('@apollo/server');
const { buildGraphQLSchema, createApolloServer } = require('../../src/server/graphql.js');

describe('GraphQL API', () => {
  let server;

  before(async () => {
    process.env.ORCA_DB_URL = ':memory:';
    const { initializeDatabaseInstance } = require('../../src/db');
    await initializeDatabaseInstance();

    const { server: apolloServer } = createApolloServer();
    server = apolloServer;
    await server.start();
  });

  after(async () => {
    if (server) {
      await server.stop();
    }
  });

  describe('Schema', () => {
    it('should build valid schema', () => {
      const schema = buildGraphQLSchema();
      assert.ok(schema);
      assert.ok(schema._queryType);
      assert.ok(schema._mutationType);
      assert.ok(schema._subscriptionType);
    });
  });

  describe('Queries', () => {
    it('should return health status', async () => {
      const response = await server.executeOperation({
        query: `
          query {
            health {
              status
              uptime
              timestamp
            }
          }
        `
      });

      assert.strictEqual(response.body.kind, 'single');
      const data = response.body.singleResult.data;
      assert.strictEqual(data.health.status, 'ok');
      assert.ok(data.health.uptime > 0);
      assert.ok(data.health.timestamp);
    });

    it('should require auth for agents query', async () => {
      const response = await server.executeOperation({
        query: `
          query {
            agents {
              id
              name
            }
          }
        `
      });

      assert.strictEqual(response.body.kind, 'single');
      assert.ok(response.body.singleResult.errors);
      assert.ok(response.body.singleResult.errors.length > 0);
    });

    it('should require auth for sessions query', async () => {
      const response = await server.executeOperation({
        query: `
          query {
            sessions {
              id
              prompt
            }
          }
        `
      });

      assert.strictEqual(response.body.kind, 'single');
      assert.ok(response.body.singleResult.errors);
    });

    it('should require auth for analytics query', async () => {
      const response = await server.executeOperation({
        query: `
          query {
            analytics {
              totalOperations
              totalTokens
            }
          }
        `
      });

      assert.strictEqual(response.body.kind, 'single');
      assert.ok(response.body.singleResult.errors);
    });
  });

  describe('Mutations', () => {
    it('should register a new user', async () => {
      const response = await server.executeOperation({
        query: `
          mutation Register($input: RegisterInput!) {
            register(input: $input) {
              user {
                id
                username
                email
              }
              accessToken
            }
          }
        `,
        variables: {
          input: {
            username: `graphqluser_${Date.now()}`,
            email: `graphql_${Date.now()}@example.com`,
            password: 'Password123!'
          }
        }
      });

      assert.strictEqual(response.body.kind, 'single');
      const result = response.body.singleResult;
      if (result.errors) {
        console.log('Registration errors:', result.errors.map(e => e.message));
      }
      assert.ok(result.data);
      assert.ok(result.data.register.user);
      assert.ok(result.data.register.accessToken);
    });

    it('should login with valid credentials', async () => {
      const username = `logingql_${Date.now()}`;
      const password = 'Password123!';

      // Register first
      await server.executeOperation({
        query: `
          mutation Register($input: RegisterInput!) {
            register(input: $input) {
              user { id }
            }
          }
        `,
        variables: {
          input: {
            username,
            email: `${username}@example.com`,
            password
          }
        }
      });

      // Then login
      const response = await server.executeOperation({
        query: `
          mutation Login($input: LoginInput!) {
            login(input: $input) {
              user {
                id
                username
              }
              accessToken
              refreshToken
            }
          }
        `,
        variables: {
          input: {
            usernameOrEmail: username,
            password
          }
        }
      });

      assert.strictEqual(response.body.kind, 'single');
      const result = response.body.singleResult;
      if (result.errors) {
        console.log('Login errors:', result.errors.map(e => e.message));
      }
      assert.ok(result.data);
      assert.ok(result.data.login.accessToken);
      assert.ok(result.data.login.refreshToken);
    });

    it('should fail login with invalid credentials', async () => {
      const response = await server.executeOperation({
        query: `
          mutation Login($input: LoginInput!) {
            login(input: $input) {
              user { id }
            }
          }
        `,
        variables: {
          input: {
            usernameOrEmail: 'nonexistent',
            password: 'wrong'
          }
        }
      });

      assert.strictEqual(response.body.kind, 'single');
      const result = response.body.singleResult;
      assert.ok(result.errors);
    });
  });

  describe('Server Creation', () => {
    it('should create Apollo Server instance', () => {
      const { server: testServer } = createApolloServer();
      assert.ok(testServer);
    });

    it('should support schema introspection', async () => {
      const { server: testServer } = createApolloServer();
      await testServer.start();
      const response = await testServer.executeOperation({
        query: '{ __typename }'
      });
      assert.strictEqual(response.body.singleResult.data.__typename, 'Query');
      await testServer.stop();
    });
  });
});
