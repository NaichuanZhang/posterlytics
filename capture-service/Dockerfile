# Playwright's official image ships Chromium + all system libs pre-installed,
# pinned to the same version as the npm dependency above.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app

# Install deps first for layer caching.
COPY package.json package-lock.json* ./
RUN npm ci

# Build TypeScript -> dist/.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Drop dev deps after build to slim the runtime image.
RUN npm prune --omit=dev

CMD ["node", "dist/server.js"]
