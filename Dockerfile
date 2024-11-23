# Use an Alpine-based Node.js image
FROM node:lts-alpine

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
    chown -R node:node /app

# Set working directory and copy package.json for dependency installation
WORKDIR /app
COPY package.json ./

# Install dependencies and clear npm cache
RUN npm install --omit=dev && \
    npm cache clean --force

# Copy application source code
COPY --chown=node:node ./index.js ./

# Use non-root user and set default command
USER node
CMD ["node", "index.js"]
