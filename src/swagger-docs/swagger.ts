const port = process.env.PORT || 5000;

export const swaggerOptions = {
  definition: {
    openapi: "3.0.1",
    info: {
      title: "Wallet API",
      version: "1.0.0",
      description: "APIs for the Wallet System",
      contact: {
        name: "Your Name",
        email: "you@example.com",
        url: "https://www.example.com/",
      },
      license: {
        name: "Apache 2.0",
        url: "https://www.apache.org/licenses/LICENSE-2.0.html",
      },
    },
    servers: [
      {
        url: `http://localhost:${port}/`,
        description: "Local Server",
      },
      //  Other environments and their descriptions can be added here
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: [
    "src/routes/*.ts", // All your route files
    "src/routes/**/*.ts", // Nested routes
    "src/controllers/**/*.ts", // Controller doc annotations
    "src/swagger-docs/*.docs.ts", // Modular swagger docs
  ],
};
