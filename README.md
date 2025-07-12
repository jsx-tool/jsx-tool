# Filemap CLI

A development server and CLI tool for the Filemap ecosystem, providing proxy services, WebSocket connections, and development utilities.

## Installation

```bash
npm install -g @filemap/cli
```

## Usage

### Basic Commands

```bash
# Start the development server
filemap start

# Configure the CLI
filemap configure

# Switch between different configurations
filemap switch

# Update to the latest version
filemap update
```

### Development Mode

```bash
# Run in development mode with a specific project
npm run dev -- --from ../my-app/
```

## Development

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn

### Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```

### Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build the TypeScript project
- `npm run test` - Run test suite
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues automatically

### Project Structure

```
src/
├── commands/          # CLI command implementations
├── services/          # Core services and utilities
├── types/            # TypeScript type definitions
└── utils/            # Utility functions
```

## Features

- **Proxy Server**: HTTP/HTTPS proxy capabilities
- **WebSocket Support**: Real-time communication
- **Configuration Management**: Flexible configuration system
- **Desktop Integration**: Desktop client registry and communication
- **File System API**: File system operations and validation
- **Key Management**: Secure key handling and verification

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For support and questions, please refer to the project documentation or create an issue in the repository.
