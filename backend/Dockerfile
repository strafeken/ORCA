FROM node:24-alpine
WORKDIR /app

# ffmpeg (with ffprobe) is required at runtime to transcode and probe the
# duration of uploaded voice messages (see utils/audio.js). It is not bundled
# in node:*-alpine, so install it explicitly.
RUN apk add --no-cache ffmpeg

COPY package*.json ./
RUN npm ci --only=production

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY . .
RUN chown -R root:root /app && mkdir -p logs uploads && chown -R appuser:appgroup logs uploads
USER appuser

EXPOSE 3000
CMD ["node", "server.js"]