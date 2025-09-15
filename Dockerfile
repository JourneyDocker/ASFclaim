# Use an Alpine-based bun image
FROM oven/bun:1.2.22-alpine

# Set environment variables for the timezone and application
ENV TZ=America/Chicago \
    ASF_PROTOCOL=http \
    ASF_HOST=localhost \
    ASF_PORT=1242 \
    ASF_COMMAND_PREFIX=! \
    ASF_BOTS=asf \
    ASF_CLAIM_INTERVAL=3 \
    WEBHOOK_URL=none \
    WEBHOOK_ENABLEDTYPES=error;warn;success \
    WEBHOOK_SHOWACCOUNTSTATUS=true

# Install dependencies and set up app directory
RUN apk add --no-cache tzdata && \
    mkdir -p /app/storage && \
    chown -R bun:bun /app

# Set working directory and copy package.json for dependency installation
WORKDIR /app
COPY package.json ./

# Install dependencies
RUN bun install

# Copy application source code
COPY --chown=bun:bun ./index.js ./

# Use non-root user and set default command
USER bun
CMD ["bun", "index.js"]
