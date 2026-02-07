# Use official Node.js image (lightweight Alpine version)
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy package files first to leverage Docker cache for dependencies
COPY package*.json ./

# Install production dependencies
# --omit=dev ensures only dependencies in "dependencies" are installed
RUN npm ci --omit=dev

# Copy the rest of the application code
COPY . .

# Expose port 8080 (Google Cloud Run default)
EXPOSE 8080

# Start the application
CMD ["npm", "start"]
