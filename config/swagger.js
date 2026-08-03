const swaggerJSDoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Arknote API Documentation',
      version: '1.0.0',
      description: 'API Documentation for Arknote System (Node.js & Express Backend)',
    },
    servers: [
      {
        url: process.env.SERVER_URL || 'https://arknote-be-1.onrender.com',
        description: 'Production Server (Render)',
      },
      {
        url: 'http://localhost:5000',
        description: 'Local Development Server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT authorization token in the format: Bearer <token>',
        },
      },
    },
  },
  apis: ['./routes/*.js'],
};

const swaggerSpec = swaggerJSDoc(options);

module.exports = swaggerSpec;
