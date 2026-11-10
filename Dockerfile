# Build stage: install everything, build the web app and the server.
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Runtime stage: production dependencies only, built assets, committed migrations, plan.json.
# WORKDIR /app makes runMigrations' default process.cwd()/drizzle resolve to /app/drizzle.
FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
COPY plan.json ./plan.json
EXPOSE 8080
USER node
CMD ["node", "--import", "./dist/server/telemetry.js", "dist/server/main.js"]
