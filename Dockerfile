FROM node:20-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=web /web/dist ./web/dist
RUN mkdir -p /app/data/media /app/data/backups && chown -R node:node /app/data
USER node
ENV PORT=3000 DATA_DIR=/app/data
EXPOSE 3000
CMD ["node", "index.js"]

