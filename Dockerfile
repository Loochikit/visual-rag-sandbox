FROM node:20-alpine

# Set directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy codebase
COPY . .

# Expose port
EXPOSE 4000

# Run service
CMD ["node", "server.js"]
