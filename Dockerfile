FROM node:23-alpine

WORKDIR /app

COPY backend/package*.json ./
RUN npm install --production

COPY backend/ ./

RUN mkdir -p data logs

EXPOSE 3001

CMD ["node", "--experimental-sqlite", "src/index.js"]
