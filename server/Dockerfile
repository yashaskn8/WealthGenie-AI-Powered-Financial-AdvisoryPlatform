FROM node:22-alpine

WORKDIR /app

COPY server/package*.json ./
RUN npm ci --only=production

COPY server/. .
COPY shared /shared

EXPOSE 5000

ENV NODE_ENV=production
ENV PORT=5000
ENV TRACE_LOG_PATH=/app/traces.jsonl
ARG APP_BUILD_SHA
ENV APP_BUILD_SHA=${APP_BUILD_SHA}

RUN chown -R node:node /app
USER node

CMD ["node", "server.js"]
