import app, { connectServices, disconnectServices } from './app';
import logger from './config/logger';
import { env } from './config/env';

const PORT = env.PORT;

connectServices().then(() => {
  const server = app.listen(PORT, () => {
    logger.info({ port: PORT }, "Server listening");
  });

  const shutdown = async () => {
    server.close();
    await disconnectServices();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
});
