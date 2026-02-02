# Build stage: Node based
FROM node:20-bookworm-slim as build-stage

WORKDIR /app

# Copy dependency files
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Build argument for API URL (needed during build time for Vite)
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

# Build the production assets
RUN npm run build

# Production stage: Nginx based
FROM nginx:stable-alpine as production-stage

# Copy the built assets from the previous stage
COPY --from=build-stage /app/dist /usr/share/nginx/html

# Copy the Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
