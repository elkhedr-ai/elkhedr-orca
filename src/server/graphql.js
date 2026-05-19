/**
 * GraphQL Server Setup
 * Apollo Server with subscription support via WebSocket
 */

const { ApolloServer } = require('@apollo/server');
const { startStandaloneServer } = require('@apollo/server/standalone');
const { WebSocketServer } = require('ws');
const { useServer } = require('graphql-ws/use/ws');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const { typeDefs } = require('./schema.graphql.js');
const { resolvers } = require('./resolvers.js');
const { logger } = require('../utils/logger.js');

/**
 * Build executable GraphQL schema
 */
function buildGraphQLSchema() {
  return makeExecutableSchema({
    typeDefs,
    resolvers
  });
}

/**
 * Create Apollo Server instance
 */
function createApolloServer(options = {}) {
  const schema = buildGraphQLSchema();

  const server = new ApolloServer({
    schema,
    introspection: true,
    plugins: [
      {
        async serverWillStart() {
          logger.info('Apollo Server starting');
          return {
            async drainServer() {
              logger.info('Apollo Server draining');
            }
          };
        }
      }
    ],
    formatError: (error) => {
      logger.error({ error: error.message, path: error.path }, 'GraphQL error');
      return error;
    },
    ...options.apolloOptions
  });

  return { server, schema };
}

/**
 * Start standalone GraphQL server (HTTP + WebSocket for subscriptions)
 * @param {Object} options
 */
async function startGraphQLServer(options = {}) {
  const port = options.port || 4000;

  const { server, schema } = createApolloServer(options);

  // Start HTTP server
  const { url } = await startStandaloneServer(server, {
    listen: { port },
    context: async ({ req }) => {
      return { req };
    }
  });

  logger.info({ url }, 'GraphQL HTTP server started');

  // Setup WebSocket server for subscriptions on same port
  const http = require('http');
  const httpServer = http.createServer();

  const wsServer = new WebSocketServer({
    server: httpServer,
    path: '/graphql'
  });

  const wsCleanup = useServer({ schema }, wsServer);

  httpServer.listen(port + 1, () => {
    logger.info({ port: port + 1 }, 'GraphQL WebSocket server started for subscriptions');
  });

  return {
    server,
    url,
    async stop() {
      await wsCleanup.dispose();
      httpServer.close();
      await server.stop();
    }
  };
}

/**
 * Build GraphQL context from HTTP request
 * Extracts auth tokens and sets up user context
 */
async function buildContext({ req }) {
  return { req, user: null };
}

module.exports = {
  buildGraphQLSchema,
  createApolloServer,
  startGraphQLServer,
  buildContext
};
