FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
ENV NODE_ENV=production DATA_DIR=/data
VOLUME /data
USER node
CMD ["node", "src/index.js"]
