export const env = {
  apiBaseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080',
  wsBaseUrl: process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080',
  graphqlUrl: process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://localhost:8080/graphql',
  graphqlWsUrl: process.env.NEXT_PUBLIC_GRAPHQL_WS_URL || 'ws://localhost:8080/graphql',
  appName: 'Rial',
  settlementSymbol: '﷼',
  defaultChain: process.env.NEXT_PUBLIC_DEFAULT_CHAIN || 'ethereum',
} as const;

export type AppEnv = typeof env;
