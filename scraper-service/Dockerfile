# Chromium + system libraries match playwright@1.58.2 (see package-lock.json).
# https://playwright.dev/docs/docker
FROM mcr.microsoft.com/playwright:v1.58.2-jammy

WORKDIR /app

# Image already includes browser binaries; skip npm postinstall browser download.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "server.js"]
