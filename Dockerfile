FROM node:23-alpine

WORKDIR /app

# Backend dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm install --production

# Frontend build
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Backend source
COPY backend/ ./backend/

# Data & logs directories
RUN mkdir -p backend/data backend/logs

EXPOSE 3001

CMD ["node", "--experimental-sqlite", "backend/src/index.js"]
