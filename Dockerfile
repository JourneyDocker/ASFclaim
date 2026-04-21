# Stage 0: Base
FROM oven/bun:1.3.13-alpine AS base

# Set the working directory
WORKDIR /app

# Set environment variables
ENV TZ=America/Chicago \
    ASF_PROTOCOL=http \
    ASF_HOST=localhost \
    ASF_PORT=1242 \
    ASF_COMMAND_PREFIX=! \
    ASF_BOTS=asf \
    ASF_CLAIM_INTERVAL=3 \
    GITHUB_TOKEN= \
    WEBHOOK_URL=none \
    WEBHOOK_ENABLEDTYPES=error;warn;success \
    WEBHOOK_SHOWACCOUNTSTATUS=true

# Stage 1: Build
FROM base AS build

# Copy package definitions
COPY package.json .

# Install project dependencies
RUN bun install

# Copy the application source code
COPY ./index.js .

# Stage 2: Final
FROM base AS final

# Install runtime system dependencies and set up the application directory
RUN apk add --no-cache tzdata && \
    mkdir -p /app/storage && \
    chown -R bun:bun /app

# Copy dependencies and application code from the build stage
COPY --from=build --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/package.json .
COPY --from=build --chown=bun:bun /app/index.js .

# Switch to a non-root user
USER bun

# Set the default command
CMD ["bun", "index.js"]
