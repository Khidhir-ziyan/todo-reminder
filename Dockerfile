FROM node:20-alpine

WORKDIR /app

# Install ffmpeg untuk voice processing
RUN apk add --no-cache ffmpeg

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY src/ ./src/

# Create data directory for SQLite
RUN mkdir -p /app/data

# Set timezone
ENV TZ=Asia/Jakarta

CMD ["node", "src/index.js"]
