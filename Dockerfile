FROM oven/bun:1.2.4-slim
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install
COPY . .
RUN bun run lint && bun run format && bun run typecheck
RUN bun run build
ENTRYPOINT [ "bun", "run", "cli", "run" ]