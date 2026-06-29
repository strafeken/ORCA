FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
# NOSONAR - build context is restricted by .dockerignore
COPY . .
RUN chown -R root:root /app && mkdir -p logs && chown -R appuser:appgroup logs
USER appuser

EXPOSE 3000
CMD ["node", "server.js"]