# Chromium + system libraries match playwright@1.58.2 (see package-lock.json).
# https://playwright.dev/docs/docker
FROM mcr.microsoft.com/playwright:v1.58.2-jammy

WORKDIR /app

# Official image ships browsers under /ms-playwright; npm playwright must use that path.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# Image already includes browser binaries; skip npm postinstall browser download.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends libreoffice \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "server.js"]
