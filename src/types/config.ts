export interface JSXToolConfig {
  serverPort: number
  serverHost: string
  serverProtocol: 'http' | 'https'
  noProxy: boolean

  proxyPort: number
  proxyHost: string
  proxyProtocol: 'http' | 'https'

  wsPort: number
  wsHost: string
  wsProtocol: 'ws' | 'wss'

  workingDirectory: string
  nodeModulesDir?: string
  debug: boolean
  injectAt: string
  additionalDirectories?: string[]

  insecure?: boolean
  logging?: boolean
}

export const DEFAULT_CONFIG: JSXToolConfig = {
  serverPort: 4000,
  serverHost: 'localhost',
  serverProtocol: 'http',
  noProxy: false,

  proxyPort: 3000,
  proxyHost: 'localhost',
  proxyProtocol: 'http',

  wsPort: 12021,
  wsHost: 'localhost',
  wsProtocol: 'ws',

  workingDirectory: process.cwd(),
  nodeModulesDir: undefined,
  debug: false,
  logging: false,
  injectAt: '</head>'
};
