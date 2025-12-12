
# Use the official Puppeteer image which includes Chrome and all dependencies
FROM ghcr.io/puppeteer/puppeteer:21

# Switch to root to install dependencies and build
USER root

# Set working directory
WORKDIR /app

# Copy package files
COPY scrapper-suite/package*.json ./

# Install dependencies
# We use --unsafe-perm because we are temporarily root
RUN npm ci

# Copy the rest of the application code
COPY scrapper-suite/ ./

# Build the Next.js app
# Set ENV for Next.js build
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Expose port
EXPOSE 3000

# Fix permissions for pptruser
RUN chown -R pptruser:pptruser /app

# Switch back to the non-privileged pptruser provided by the base image
USER pptruser

# Start the application
CMD ["npm", "start"]
