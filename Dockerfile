FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
ENV HOST=0.0.0.0 PORT=3000 DB_FILE=/data/armapay.db COOKIE_SECURE=1
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
