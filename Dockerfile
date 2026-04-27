# Playwright base image ships with Chromium and all required system libs.
# Tag must match the playwright npm version in package.json.
FROM mcr.microsoft.com/playwright:v1.58.2-jammy

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

RUN npm prune --omit=dev

EXPOSE 3000

CMD ["node", "dist/index.js"]
