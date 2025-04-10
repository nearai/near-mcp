# Contributing to NEAR MCP

Thank you for your interest in contributing to NEAR MCP! This document provides guidelines and instructions for contributing to this project.

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- Bun (v1.0.0 or higher) - preferred runtime
- Git

### Development Environment Setup

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR-USERNAME/near-mcp.git
   cd near-mcp
   ```
3. Add the original repository as an upstream remote:
   ```bash
   git remote add upstream https://github.com/nearai/near-mcp.git
   ```
4. Install dependencies:
   ```bash
   npm install
   # or
   bun install
   ```
5. Create a branch for your work:
   ```bash
   git checkout -b feature/your-feature-name
   ```

### Development Workflow

1. Make your changes in your feature branch
2. To test you changes locally with the `claude` cli, run:
   If you don't have the `claude` cli installed, you can install it with:
   ```bash
   npm install -g @anthropic-ai/claude-cli
   or
   bun add -g @anthropic-ai/claude-cli
   ```
   Then add the `near-mcp` tool to the `claude` cli:
   ```bash
   claude mcp add near-mcp bun run cli
   ```
   This adds the `near-mcp` tool to the `claude` cli from your local build.
3. Run the TypeScript compiler to check for type errors:
   ```bash
   npm run typecheck
   # or
   bun run typecheck
   ```
4. Format your code:
   ```bash
   npm run format:fix
   # or
   bun run format:fix
   ```
5. Run linting:
   ```bash
   npm run lint
   # or
   bun run lint
   ```
6. Fix any linting issues:
   ```bash
   npm run lint:fix
   # or
   bun run lint:fix
   ```
7. Build the project:
   ```bash
   npm run build
   # or
   bun run build
   ```

## Pull Request Process

1. Update the README.md if needed with details of changes to the interface
2. Ensure all checks pass (linting, type checking, tests if applicable)
3. Make sure your code follows the existing style guidelines
4. Submit a pull request to the `main` branch
5. The maintainers will review your PR as soon as possible

### PR Guidelines

- Keep PRs small and focused on a single feature or bug fix
- Write clear commit messages that describe what you've changed
- Add or update tests as necessary
- Document new code based on the project's documentation standards
- Make sure your PR is up-to-date with the latest changes from `main`

## Style Guidelines

### Code Style

This project uses ESLint and Prettier to maintain code quality and consistency:

- Follow TypeScript best practices
- Use meaningful variable and function names
- Write comments for complex logic
- Use ES6+ features when appropriate
- Follow the existing patterns in the codebase

### Commit Messages

We follow conventional commit standards:

- feat: A new feature
- fix: A bug fix
- docs: Documentation only changes
- style: Changes that do not affect the meaning of the code
- refactor: A code change that neither fixes a bug nor adds a feature
- perf: A code change that improves performance
- test: Adding missing tests or correcting existing tests
- chore: Changes to the build process or auxiliary tools

Example: `feat: add account balance retrieval endpoint`

## Feature Requests and Bug Reports

If you'd like to request a feature or report a bug:

1. First, check if the feature/bug has already been requested/reported in the issues
2. If not, create a new issue
3. Clearly describe the feature/bug
4. For bugs, provide steps to reproduce, expected behavior, and actual behavior
5. Add relevant tags

## Testing

- When adding new features, please include tests
- Run existing tests to make sure your changes don't break existing functionality
- Consider edge cases in your implementation and tests

## Documentation

- Update documentation for any new features or changes to existing features
- Document public APIs with JSDoc comments
- Keep the README.md up-to-date

## License

By contributing to this project, you agree that your contributions will be licensed under the project's license (MIT).

## Questions?

If you have any questions about contributing, please feel free to ask in our community channels or open an issue for clarification.

Thank you for contributing to NEAR MCP!
