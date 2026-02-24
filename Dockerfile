FROM node:20-slim

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package*.json ./
RUN npm install --production

COPY backend/ ./

RUN mkdir -p data logs

CMD ["node", "src/index.js"]
