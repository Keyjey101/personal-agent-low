FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci && node node_modules/esbuild/install.js || true
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/web-dist ./web-dist
COPY --from=build /app/migrations ./migrations
USER node
CMD ["node", "--max-old-space-size=384", "dist/src/index.js"]
