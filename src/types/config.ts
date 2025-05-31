export interface FilemapConfig {
  serverPort: number
  serverHost: string
  serverProtocol: 'http' | 'https'

  proxyPort: number
  proxyHost: string
  proxyProtocol: 'http' | 'https'

  wsPort: number
  wsHost: string
  wsProtocol: 'ws' | 'wss'

  workingDirectory: string
  debug: boolean
  injectAt: string
}

export const DEFAULT_CONFIG: FilemapConfig = {
  serverPort: 3001,
  serverHost: 'localhost',
  serverProtocol: 'http',

  proxyPort: 3000,
  proxyHost: 'localhost',
  proxyProtocol: 'http',

  wsPort: 3002,
  wsHost: 'localhost',
  wsProtocol: 'ws',

  workingDirectory: process.cwd(),
  debug: false,
  injectAt: '</head>'
};
