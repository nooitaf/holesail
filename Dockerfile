FROM node:18-slim

# Install dependencies needed for some native modules if any
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package.json and package-lock.json if it exists
COPY package*.json ./

# Install dependencies
# Using --no-optional to avoid some bare-specific native modules that might fail on standard linux if they are platform-specific
RUN npm install

# Copy the rest of the application
COPY . .

# Expose the port used by filemanager
EXPOSE 8989
EXPOSE 5409

# Start the filemanager
# We use --public to make it accessible without a DHT key for local testing
CMD ["node", "src/bin/holesail.mjs", "--filemanager", "testfolder", "--port", "8989", "--host", "0.0.0.0", "--username", "admin", "--password", "admin", "--public", "--role", "admin"]
