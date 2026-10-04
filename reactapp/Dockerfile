# Build stage
FROM node:22-alpine AS build

WORKDIR /app

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
ARG VITE_BUILD_SHA
ENV VITE_BUILD_SHA=$VITE_BUILD_SHA

COPY reactapp/package*.json ./
RUN npm ci

COPY reactapp/. .
# The frontend intentionally imports two shared root-level contracts. Keep the
# Docker build context at the project root and place shared/ where the existing
# relative imports resolve (/app/src/... -> /shared/...).
COPY shared /shared
RUN chown -R node:node /app /shared
USER node
RUN npm run build

# Production stage
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY reactapp/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
